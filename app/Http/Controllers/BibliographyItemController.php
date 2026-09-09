<?php

namespace App\Http\Controllers;

use App\Http\Requests\ImportBibliographyRequest;
use App\Http\Requests\StoreBibliographyItemRequest;
use App\Http\Requests\UpdateBibliographyItemRequest;
use App\Models\BibliographyItem;
use App\Models\Edition;
use App\Support\Bibliography\Biblatex;
use App\Support\Bibliography\BiblatexReader;
use App\Support\Bibliography\BiblatexWriter;
use App\Support\Bibliography\CitationLabel;
use App\Support\Bibliography\EditionBibliography;
use App\Support\Bibliography\ReferenceFormatter;
use App\Support\Bibliography\Suggestions;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response as InertiaResponse;

/**
 * The common bibliography: one list every conjecture and every edition
 * draws its literature from, held in biblatex's own terms so it exports
 * as a .bib file. Readable by everyone; every member adds to it, and
 * changes only what nobody else relies on — see BibliographyItemPolicy.
 */
class BibliographyItemController extends Controller
{
    public function index(Request $request): InertiaResponse
    {
        $search = (string) $request->query('q', '');

        $items = BibliographyItem::query()
            ->search($search)
            ->withCount('references')
            ->orderBy('label')
            ->orderBy('citation_key')
            ->get()
            ->map(fn (BibliographyItem $item) => [
                'id' => $item->id,
                'entry_type' => $item->entry_type,
                'citation_key' => $item->citation_key,
                'label' => $item->label,
                'fields' => $item->fields,
                'reference' => ReferenceFormatter::runs($item),
                'references_count' => $item->references_count,
                'biblatex' => BiblatexWriter::entry($item),
                // A member may only change what nobody else relies on — see
                // BibliographyItemPolicy.
                'can_edit' => $request->user()?->can('update', $item) ?? false,
                'can_delete' => $request->user()?->can('delete', $item) ?? false,
            ])
            ->values();

        return Inertia::render('Bibliography/Index', [
            'items' => $items,
            'can' => ['create' => $request->user() !== null],
            'search' => $search,
            'registry' => Biblatex::registry(),
            // Names, presses, journals, places and series already in the
            // list, offered while typing so spellings converge.
            'suggestions' => Suggestions::all(),
        ]);
    }

    /**
     * Where an item is cited — listed before a delete is offered, since an
     * item nothing cites is the only kind that can go.
     *
     * @return list<array{kind: string, label: string}>
     */
    private function citedBy(BibliographyItem $item): array
    {
        $references = $item->references()
            ->with(['conjecture.canonicalPassage:id,label', 'edition:id,title', 'canonicalPassage:id,label'])
            ->get();

        $citedBy = [];

        foreach ($references as $reference) {
            if ($reference->conjecture_id !== null) {
                $passage = $reference->conjecture?->canonicalPassage;
                $citedBy[] = ['kind' => 'conjecture', 'label' => 'a conjecture on '.($passage !== null ? $passage->label : '?')];

                continue;
            }

            $passage = $reference->canonicalPassage;
            $edition = $reference->edition;
            $citedBy[] = ['kind' => 'passage', 'label' => ($passage !== null ? $passage->label : '?').' in “'.($edition !== null ? $edition->title : '?').'”'];
        }

        return $citedBy;
    }

    public function store(StoreBibliographyItemRequest $request): RedirectResponse
    {
        $item = new BibliographyItem([
            'entry_type' => $request->validated('entry_type'),
            'fields' => $request->cleanFields(),
            'user_id' => $request->user()->id,
        ]);

        $item->citation_key = $request->validated('citation_key') ?? $this->freshKey($item);
        $item->refreshLabel();
        $item->save();

        // The item form is also opened from a picker, which needs to know
        // which item was just made so it can attach it.
        session()->flash('created_bibliography_item_id', $item->id);

        return back();
    }

    public function update(UpdateBibliographyItemRequest $request, BibliographyItem $item): RedirectResponse
    {
        $item->fill([
            'entry_type' => $request->validated('entry_type'),
            'fields' => $request->cleanFields(),
        ]);
        $item->citation_key = $request->validated('citation_key') ?? $item->citation_key;
        $item->refreshLabel();
        $item->save();

        return back();
    }

    /**
     * Refused while anything cites the item: a citation without its work
     * is nothing, and deleting the work under it would silently blank an
     * apparatus entry. The references list says where to look.
     */
    public function destroy(BibliographyItem $item): RedirectResponse
    {
        $this->authorize('delete', $item);

        $citedBy = $this->citedBy($item);

        if ($citedBy !== []) {
            throw ValidationException::withMessages([
                'item' => 'This item is cited by '.collect($citedBy)->pluck('label')->join(', ', ' and ').' — remove those citations first.',
            ]);
        }

        $item->delete();

        return back();
    }

    /**
     * The whole list as a .bib file.
     */
    public function export(): Response
    {
        return $this->bibFile(BibliographyItem::query()->get(), 'bibliography.bib');
    }

    /**
     * Only what one edition cites — its passages' and its conjectures'
     * literature — as a .bib file of its own.
     */
    public function exportEdition(Edition $edition): Response
    {
        $this->authorize('view', $edition);

        return $this->bibFile(
            BibliographyItem::whereIn('id', EditionBibliography::itemIds($edition))->get(),
            Str::slug($edition->title).'.bib',
        );
    }

    /**
     * @param  EloquentCollection<int, BibliographyItem>  $items
     */
    private function bibFile(EloquentCollection $items, string $filename): Response
    {
        return response(BiblatexWriter::file($items), 200, [
            'Content-Type' => 'application/x-bibtex; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$filename.'"',
        ]);
    }

    /**
     * Read a .bib file into the list. Each entry becomes an item; an entry
     * whose key is already taken is skipped — or, with `replace`, updates
     * the item under that key (its citations stay, the work is the same).
     * What could not be read is reported, not fatal: a large file with one
     * odd entry should still land the rest.
     */
    public function import(ImportBibliographyRequest $request): RedirectResponse
    {
        $result = BiblatexReader::read($request->bibtex());
        $replace = $request->boolean('replace');
        $imported = 0;
        $replaced = 0;
        $skipped = [];

        foreach ($result['entries'] as $entry) {
            $existing = BibliographyItem::where('citation_key', $entry['citation_key'])->first();

            if ($existing !== null && (! $replace || ! $request->user()->can('update', $existing))) {
                $skipped[] = $entry['citation_key'];

                continue;
            }

            $item = $existing ?? new BibliographyItem(['user_id' => $request->user()->id]);
            $item->entry_type = $entry['entry_type'];
            $item->citation_key = $entry['citation_key'];
            $item->fields = $entry['fields'];
            $item->refreshLabel();
            $item->save();

            $existing !== null ? $replaced++ : $imported++;
        }

        $report = ['Imported '.$imported.' '.($imported === 1 ? 'item' : 'items')];

        if ($replaced > 0) {
            $report[] = 'replaced '.$replaced;
        }

        if ($skipped !== []) {
            $report[] = 'skipped '.count($skipped).' already in the list ('.implode(', ', array_slice($skipped, 0, 10)).(count($skipped) > 10 ? ', …' : '').')';
        }

        $message = implode(', ', $report).'.';

        if ($result['warnings'] !== []) {
            $message .= ' '.implode(' ', $result['warnings']);
        }

        session()->flash('message', $message);

        return back();
    }

    /**
     * A citation key from the label — "wilamowitz1927", "dover1987a" —
     * made unique among the keys already taken.
     */
    private function freshKey(BibliographyItem $item): string
    {
        $base = Str::of(CitationLabel::base($item->entry_type, $item->fields))
            ->ascii()
            ->lower()
            ->replaceMatches('/\bet al\.?/', '')
            ->replaceMatches('/[^a-z0-9]+/', '')
            ->toString();

        if ($base === '') {
            $base = $item->entry_type;
        }

        $key = $base;
        $suffixes = ['', ...range('a', 'z')];

        foreach ($suffixes as $index => $suffix) {
            $key = $base.$suffix;

            if (! BibliographyItem::where('citation_key', $key)->exists()) {
                return $key;
            }

            if ($index === count($suffixes) - 1) {
                return $base.'-'.Str::lower(Str::random(4));
            }
        }

        return $key;
    }
}
