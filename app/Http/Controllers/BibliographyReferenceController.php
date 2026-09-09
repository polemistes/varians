<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreBibliographyReferenceRequest;
use App\Http\Requests\UpdateBibliographyReferenceRequest;
use App\Models\BibliographyItem;
use App\Models\BibliographyReference;
use App\Support\Bibliography\ReferenceFormatter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * Citations of the common bibliography by things that already exist — a
 * recorded conjecture, or a passage of an edition — saved immediately, as
 * notes are. A NEW conjecture sends its citations in its own request
 * instead (see ReferenceAttacher), so it is never created without them.
 */
class BibliographyReferenceController extends Controller
{
    /**
     * The picker's typeahead: items matching the typed text, with the
     * short label to cite by and the full reference to recognise it by.
     */
    public function search(Request $request): JsonResponse
    {
        $items = BibliographyItem::query()
            ->search((string) $request->query('q', ''))
            ->orderBy('label')
            ->limit(20)
            ->get()
            ->map(fn (BibliographyItem $item) => [
                'id' => $item->id,
                'label' => $item->label,
                'reference' => ReferenceFormatter::text($item),
            ])
            ->values();

        return response()->json($items);
    }

    public function store(StoreBibliographyReferenceRequest $request): RedirectResponse
    {
        $target = $request->filled('conjecture_id')
            ? ['conjecture_id' => (int) $request->validated('conjecture_id'), 'edition_id' => null, 'canonical_passage_id' => null]
            : ['conjecture_id' => null, 'edition_id' => (int) $request->validated('edition_id'), 'canonical_passage_id' => (int) $request->validated('canonical_passage_id')];

        $position = (int) BibliographyReference::query()
            ->where($target)
            ->max('position');

        BibliographyReference::create([
            ...$target,
            'bibliography_item_id' => (int) $request->validated('bibliography_item_id'),
            'prenote' => $request->validated('prenote'),
            'postnote' => $request->validated('postnote'),
            'position' => $position + 1,
        ]);

        return back();
    }

    public function update(UpdateBibliographyReferenceRequest $request, BibliographyReference $reference): RedirectResponse
    {
        $reference->update($request->validated());

        return back();
    }

    public function destroy(BibliographyReference $reference): RedirectResponse
    {
        $reference->delete();

        return back();
    }
}
