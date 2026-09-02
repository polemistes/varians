<?php

namespace App\Http\Controllers;

use App\Enums\Layer;
use App\Enums\WitnessType;
use App\Http\Requests\StoreWitnessRequest;
use App\Models\ManuscriptImage;
use App\Models\Tag;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\Witness;
use App\Models\Work;
use App\Support\DeletionImpact;
use App\Support\Transcription\LayerCorrespondence;
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
        $witness = Witness::create($request->safe()->only(['type', 'siglum', 'label']));

        if ($witness->type === WitnessType::Manuscript) {
            $witness->manuscript()->create($request->safe()->only(['repository', 'shelfmark', 'date_text']));
        }

        return redirect()->route('witnesses.show', $witness);
    }

    /**
     * The witness workbench: the transcription on the left, the manuscript on
     * the right, both scoped to whichever page is being worked on.
     *
     * This absorbed the separate transcription editor. Keeping them apart
     * meant a scholar transcribing a manuscript moved between two pages to do
     * one job, and neither of them could show the text beside the leaf it was
     * copied from.
     *
     * Which transcription and which layer are in the URL rather than in
     * client state: the layer's segments, regions and page breaks all have to
     * be loaded for it, so choosing is a visit.
     */
    public function show(Request $request, Witness $witness): Response
    {
        $this->authorize('view', $witness);

        $witness->load('manuscript');

        $transcriptions = $witness->transcriptions()->visibleTo($request->user())
            ->orderBy('position')->orderBy('id')
            ->get(['id', 'witness_id', 'name', 'position', 'visibility']);

        // The one asked for, else the only one there is — a witness with a
        // single transcription opens straight into it.
        $selected = $transcriptions->firstWhere('id', (int) $request->query('transcription'))
            ?? $transcriptions->first();

        $layer = $selected === null ? null : $this->selectedLayer($selected, $request->query('layer'));

        if ($layer !== null) {
            $layer->load([
                'transcription',
                'transcription.pageBreaks' => fn ($query) => $query->orderBy('start_line'),
                'segments' => fn ($query) => $query->orderBy('start_offset'),
                'segments.canonicalPassage.work',
                'regions' => fn ($query) => $query->orderBy('position'),
                'tags',
            ]);

            $layer->setAttribute('deletion_impact', DeletionImpact::forTranscription($layer));
        }

        if ($witness->manuscript) {
            $pages = $witness->manuscript->pages()->orderBy('position')->get();
            $images = $witness->manuscript->images()->visibleTo($request->user())
                ->with(['features', 'manuscriptPage'])->orderBy('position')->get();
            $images->each(fn (ManuscriptImage $image) => $image->setAttribute('deletion_impact', DeletionImpact::forManuscriptImage($image)));

            $pages->each(fn ($page) => $page->setRelation(
                'images',
                $images->where('manuscript_page_id', $page->id)->values(),
            ));

            $witness->manuscript->setRelation('pages', $pages);
            $witness->manuscript->setRelation('images', $images);
        }

        $witness->setRelation('works', $witness->relatedWorks()->get(['works.id', 'works.title', 'works.slug']));
        $witness->setAttribute('deletion_impact', DeletionImpact::forWitness($witness));

        return Inertia::render('Witnesses/Show', [
            'witness' => $witness,
            'transcriptions' => $transcriptions,
            'transcription' => $layer,
            // The page division belongs to the transcription and is given in
            // lines, so it is the same however either layer is measured — see
            // TranscriptionPageBreak.
            'pageBreaks' => $layer?->transcription->pageBreaks
                ->sortBy('start_line')->values() ?? collect(),
            // Whether this layer and its sibling still share the word
            // skeleton normalization is supposed to preserve — see
            // LayerCorrespondence. A closure so the autosave partial reload
            // can recompute it per save without re-running the whole page.
            'layerCorrespondence' => fn () => $this->layerCorrespondence($layer),
            'works' => Work::with('referenceScheme')->orderBy('title')->get(),
            'existingTags' => Tag::orderBy('name')->pluck('name'),
        ]);
    }

    /**
     * The word-structure comparison against the sibling layer, or null when
     * there is nothing to compare — no layer open, no sibling, or a sibling
     * with no text yet (one-layer workflows are legitimate).
     *
     * @return array{sibling: string, divergence: array{line: int, a_words: int|null, b_words: int|null}|null}|null
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
     * Deleting a witness cascades its manuscript (and every image, feature,
     * and image-region on it) and every one of its transcriptions (and
     * their segments, regions, tags, and — if any feed a published edition —
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
