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
     * The witness workbench: the diplomatic layer always on the left, the
     * normalized always on the right, with the shared page division between
     * them. Each pane can also show the facsimile via its tabs (that switch
     * is client-side — the facsimile's data is already on the page).
     *
     * Which TRANSCRIPT is open is in the URL (`?transcript=12`) rather than
     * in client state: a layer's segments, regions and page breaks all have
     * to be loaded for it, so choosing one is a visit — and a bookmark
     * reproduces the whole arrangement.
     */
    public function show(Request $request, Witness $witness): Response
    {
        $this->authorize('view', $witness);

        $transcripts = $witness->transcriptions()->visibleTo($request->user())
            ->orderBy('position')->orderBy('id')
            ->with(['layers' => fn ($query) => $query->select('id', 'transcription_id', 'layer')->orderBy('layer')])
            ->get(['id', 'witness_id', 'name', 'position', 'visibility']);

        $transcript = $this->selectedTranscript($request, $transcripts);
        $layerId = fn (Layer $layer): ?int => $transcript?->layers
            ->firstWhere('layer', $layer)?->id;
        [$left, $right] = [$layerId(Layer::Diplomatic), $layerId(Layer::Normalized)];

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
     * The transcript both panes show: `?transcript=12`, with the legacy
     * forms mapped so old links and bookmarks still land — `?transcription=`
     * named a transcription directly, and `?left=layer-N`/`?right=layer-N`
     * named a layer whose transcript is the one meant. Defaults to the
     * witness's first transcript. Which SIDE each layer takes is not a
     * choice: diplomatic is always left, normalized always right.
     *
     * @param  Collection<int, Transcription>  $transcripts
     */
    private function selectedTranscript(Request $request, $transcripts): ?Transcription
    {
        $byId = fn (int $id): ?Transcription => $transcripts->firstWhere('id', $id);

        foreach (['transcript', 'transcription'] as $param) {
            $named = $byId((int) $request->query($param));

            if ($named !== null) {
                return $named;
            }
        }

        foreach (['left', 'right'] as $param) {
            $value = (string) $request->query($param);

            if (preg_match('/^layer-(\d+)$/', $value, $matches) === 1) {
                $owner = $transcripts->first(fn (Transcription $transcript) => $transcript->layers
                    ->contains('id', (int) $matches[1]));

                if ($owner !== null) {
                    return $owner;
                }
            }
        }

        return $transcripts->first();
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
