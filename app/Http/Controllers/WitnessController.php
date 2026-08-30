<?php

namespace App\Http\Controllers;

use App\Enums\WitnessType;
use App\Http\Requests\StoreWitnessRequest;
use App\Models\ManuscriptImage;
use App\Models\Witness;
use App\Support\DeletionImpact;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class WitnessController extends Controller
{
    public function index(Request $request): Response
    {
        $witnesses = Witness::visibleTo($request->user())->orderBy('siglum')->get();

        $witnesses->each(fn (Witness $witness) => $witness->setRelation(
            'works',
            $witness->relatedWorks()->get(['works.id', 'works.title', 'works.slug']),
        ));

        return Inertia::render('Witnesses/Index', [
            'witnesses' => $witnesses,
        ]);
    }

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

    public function show(Request $request, Witness $witness): Response
    {
        $this->authorize('view', $witness);

        $witness->load('manuscript');

        if ($witness->manuscript) {
            $images = $witness->manuscript->images()->visibleTo($request->user())->with('features')->orderBy('position')->get();
            $images->each(fn (ManuscriptImage $image) => $image->setAttribute('deletion_impact', DeletionImpact::forManuscriptImage($image)));
            $witness->manuscript->setRelation('images', $images);
        }

        $witness->setRelation(
            'transcriptions',
            $witness->transcriptions()->visibleTo($request->user())->with(['user', 'tags'])->get(),
        );

        $witness->setRelation('works', $witness->relatedWorks()->get(['works.id', 'works.title', 'works.slug']));
        $witness->setAttribute('deletion_impact', DeletionImpact::forWitness($witness));

        return Inertia::render('Witnesses/Show', [
            'witness' => $witness,
        ]);
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

        return redirect()->route('witnesses.index');
    }
}
