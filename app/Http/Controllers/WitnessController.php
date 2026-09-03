<?php

namespace App\Http\Controllers;

use App\Enums\Layer;
use App\Http\Requests\StoreWitnessRequest;
use App\Http\Requests\UpdateWitnessRequest;
use App\Models\ManuscriptImage;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\Witness;
use App\Models\Work;
use App\Support\DeletionImpact;
use App\Support\Transcription\LayerCorrespondence;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class WitnessController extends Controller
{
    public function create(): Response
    {
        return Inertia::render('Witnesses/Create');
    }

    /**
     * Register a witness on its own — a witness only becomes connected to a
     * work once one of its transcriptions has a segment citing it.
     */
    public function store(StoreWitnessRequest $request): RedirectResponse
    {
        $witness = Witness::create($request->validated());

        return redirect()->route('witnesses.show', $witness);
    }

    /**
     * Every witness field is editable after the fact — a shelfmark gets
     * corrected, a date refined, a description written once the witness has
     * been studied.
     */
    public function update(UpdateWitnessRequest $request, Witness $witness): RedirectResponse
    {
        $witness->update($request->validated());

        return back();
    }

    /**
     * The witness workbench: two symmetric panes, each showing either a
     * transcript layer (a full editor) or the facsimile, with the shared
     * page division between them. Any layer of any transcript can open in
     * either pane — diplomatic beside its facsimile, diplomatic beside
     * normalized, whatever the work at hand wants.
     *
     * Which layers are open is in the URL (`?left=layer-12&right=facsimile`)
     * rather than in client state: a layer's segments, regions and page
     * breaks all have to be loaded for it, so choosing one is a visit — and
     * a bookmark reproduces the whole arrangement.
     */
    public function show(Request $request, Witness $witness): Response
    {
        $this->authorize('view', $witness);

        $transcripts = $witness->transcriptions()->visibleTo($request->user())
            ->orderBy('position')->orderBy('id')
            ->with(['layers' => fn ($query) => $query->select('id', 'transcription_id', 'layer')->orderBy('layer')])
            ->get(['id', 'witness_id', 'name', 'position', 'visibility']);

        [$left, $right] = $this->paneSelections($request, $transcripts);

        $pages = $witness->pages()->orderBy('position')->get();
        $images = $witness->images()->visibleTo($request->user())
            ->with(['features', 'manuscriptPage'])->orderBy('position')->get();
        $images->each(fn (ManuscriptImage $image) => $image->setAttribute('deletion_impact', DeletionImpact::forManuscriptImage($image)));

        $pages->each(fn ($page) => $page->setRelation(
            'images',
            $images->where('manuscript_page_id', $page->id)->values(),
        ));

        $witness->setRelation('pages', $pages);
        $witness->setRelation('images', $images);
        $witness->setAttribute('deletion_impact', DeletionImpact::forWitness($witness));

        return Inertia::render('Witnesses/Show', [
            'witness' => $witness,
            'transcripts' => $transcripts,
            // Closures so an editor's autosave can reload just the two pane
            // payloads — the rest of this page is far too heavy per keystroke.
            'leftPane' => fn () => $this->panePayload($left),
            'rightPane' => fn () => $this->panePayload($right),
            'works' => Work::with('referenceScheme')->orderBy('title')->get(),
            // For the change-witness picker in the Witness box — moving
            // between witnesses without a detour through the front page.
            'witnessOptions' => Witness::query()->visibleTo($request->user())
                ->orderBy('siglum')->get(['id', 'siglum', 'label']),
        ]);
    }

    /**
     * What each pane shows: `facsimile`, or a layer id. From `left`/`right`
     * query params (`facsimile` | `layer-{id}`), with the legacy
     * `?transcription=&layer=` form mapped onto the left pane so old links
     * still land. Defaults: the witness's working layer on the left, the
     * facsimile on the right. The same layer cannot open twice — two live
     * editors on one text would fight each other's autosaves — so a clash
     * turns the right pane into the facsimile.
     *
     * @param  Collection<int, Transcription>  $transcripts
     * @return array{0: int|null, 1: int|null} layer ids; null = facsimile
     */
    private function paneSelections(Request $request, $transcripts): array
    {
        $validIds = $transcripts->flatMap(fn (Transcription $transcript) => $transcript->layers->pluck('id'))->all();

        $parse = function (?string $value) use ($validIds): ?int {
            if ($value !== null && preg_match('/^layer-(\d+)$/', $value, $matches) === 1) {
                $id = (int) $matches[1];

                return in_array($id, $validIds, true) ? $id : null;
            }

            return null;
        };

        $left = $parse($request->query('left'));

        if ($left === null && $request->query('left') !== 'facsimile') {
            // Legacy links name a transcription (and maybe a layer); newer
            // defaults pick the layer with text, where the work is.
            $selected = $transcripts->firstWhere('id', (int) $request->query('transcription'))
                ?? $transcripts->first();
            $left = $selected === null
                ? null
                : $this->selectedLayer($selected, $request->query('layer'))?->id;
        }

        $right = $parse($request->query('right'));

        if ($right !== null && $right === $left) {
            $right = null;
        }

        return [$left, $right];
    }

    /**
     * One pane's payload: the facsimile view (all its data is already on the
     * page), or a fully loaded layer with its transcript's page breaks and
     * its correspondence to the sibling layer.
     *
     * @return array<string, mixed>
     */
    private function panePayload(?int $layerId): array
    {
        if ($layerId === null) {
            return ['view' => 'facsimile', 'layer' => null, 'pageBreaks' => [], 'correspondence' => null];
        }

        $layer = TranscriptionLayer::query()
            ->with([
                'transcription',
                'segments' => fn ($query) => $query->orderBy('start_offset'),
                'segments.canonicalPassage.work',
                'regions' => fn ($query) => $query->orderBy('position'),
            ])
            ->findOrFail($layerId);

        $layer->setAttribute('deletion_impact', DeletionImpact::forTranscription($layer));

        return [
            'view' => 'layer',
            'layer' => $layer,
            // The page division belongs to the transcript and is given in
            // lines, so it is the same however either layer is measured —
            // see TranscriptionPageBreak.
            'pageBreaks' => $layer->transcription->pageBreaks()
                ->orderBy('start_line')->get()->values(),
            'correspondence' => $this->layerCorrespondence($layer),
        ];
    }

    /**
     * The word-structure comparison against the sibling layer, or null when
     * there is nothing to compare — no layer open, no sibling, or a sibling
     * with no text yet (one-layer workflows are legitimate). Carries the
     * sibling's text too, for the side-by-side layer view that is the
     * recovery path when the structures diverge.
     *
     * @return array{sibling: string, text: string, divergence: array{line: int, a_words: int|null, b_words: int|null}|null}|null
     */
    private function layerCorrespondence(?TranscriptionLayer $layer): ?array
    {
        if ($layer === null || $layer->text === '') {
            return null;
        }

        $sibling = $layer->transcription->layers()
            ->whereKeyNot($layer->id)
            ->first();

        if ($sibling === null || $sibling->text === '') {
            return null;
        }

        return [
            'sibling' => $sibling->layer->value,
            'text' => $sibling->text,
            'divergence' => LayerCorrespondence::divergence($layer->text, $sibling->text),
        ];
    }

    /**
     * The layer to open. The one named, else whichever already has text —
     * transcribing from the manuscript begins in the diplomatic layer and
     * importing a text begins in the normalized one, so opening the one that
     * has something in it lands the editor where the work is. Falls back to
     * diplomatic, which is where a blank transcription starts.
     */
    private function selectedLayer(Transcription $transcription, ?string $requested): ?TranscriptionLayer
    {
        $layers = $transcription->layers()->get();

        if ($requested !== null) {
            $named = $layers->firstWhere('layer.value', $requested);

            if ($named !== null) {
                return $named;
            }
        }

        return $layers->first(fn (TranscriptionLayer $layer) => $layer->text !== '')
            ?? $layers->firstWhere('layer.value', Layer::Diplomatic->value)
            ?? $layers->first();
    }

    /**
     * Deleting a witness cascades its pages (and every image, feature,
     * and image-region on them) and every one of its transcriptions (and
     * their segments, regions, and — if any feed a published edition —
     * the edition's own LemmaReading selections and base-text choices). See
     * App\Support\DeletionImpact for the preview shown before this is
     * confirmed.
     */
    public function destroy(Witness $witness): RedirectResponse
    {
        $witness->delete();

        return redirect()->route('home');
    }
}
