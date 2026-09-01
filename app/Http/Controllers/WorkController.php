<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreWorkRequest;
use App\Http\Requests\UpdateWorkRequest;
use App\Models\ReferenceScheme;
use App\Models\TranscriptionLayer;
use App\Models\Witness;
use App\Models\Work;
use App\Support\DeletionImpact;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class WorkController extends Controller
{
    public function create(): Response
    {
        return Inertia::render('Works/Create', [
            'referenceSchemes' => ReferenceScheme::orderBy('name')->get(['id', 'name', 'levels']),
        ]);
    }

    public function store(StoreWorkRequest $request): RedirectResponse
    {
        $schemeId = $request->validated('reference_scheme_id');

        if (! $schemeId) {
            $schemeId = ReferenceScheme::create([
                'name' => $request->validated('new_scheme_name'),
                'levels' => $request->validated('levels'),
            ])->id;
        }

        $work = Work::create([
            'reference_scheme_id' => $schemeId,
            'title' => $request->validated('title'),
            'author' => $request->validated('author'),
            'language' => $request->validated('language'),
            'slug' => $request->validated('slug'),
        ]);

        return redirect()->route('works.show', $work);
    }

    public function show(Request $request, Work $work): Response
    {
        $this->authorize('view', $work);

        $work->load([
            'referenceScheme',
            'canonicalPassages' => fn ($query) => $query->orderBy('sort_key'),
            'editions' => fn ($query) => $query->visibleTo($request->user())->orderBy('title'),
        ]);

        $work->setRelation('witnesses', $work->relatedWitnesses()->with('manuscript')->orderBy('siglum')->get());

        $transcriptions = TranscriptionLayer::forWork($work)
            ->visibleTo($request->user())
            ->with(['witness', 'user', 'tags', 'transcription'])
            ->get();

        $allWitnesses = Witness::visibleTo($request->user())->orderBy('siglum')->get(['id', 'siglum', 'label', 'type']);

        $work->setAttribute('deletion_impact', DeletionImpact::forWork($work));

        return Inertia::render('Works/Show', [
            'work' => $work,
            'transcriptions' => $transcriptions,
            'allWitnesses' => $allWitnesses,
        ]);
    }

    /**
     * Deleting a work cascades every canonical passage of it, and through
     * those: every edition of the work (and that edition's own selections
     * and base-text choices), every lemma/collation built for it, every
     * conjecture recorded against it, and every citation segment on any
     * witness's transcription that cited it — even a witness with no other
     * connection to this work. See App\Support\DeletionImpact for the
     * preview shown before this is confirmed.
     */
    /**
     * Rename a work, or correct its author. Not its slug — that is in the URL
     * of every edition of it — and not its reference scheme, which every
     * passage address was built against.
     */
    public function update(UpdateWorkRequest $request, Work $work): RedirectResponse
    {
        $work->update($request->validated());

        return back();
    }

    public function destroy(Work $work): RedirectResponse
    {
        $work->delete();

        return redirect()->route('home');
    }
}
