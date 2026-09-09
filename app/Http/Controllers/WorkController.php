<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreWorkRequest;
use App\Http\Requests\UpdateWorkRequest;
use App\Models\Edition;
use App\Models\ReferenceScheme;
use App\Models\TranscriptionLayer;
use App\Models\Work;
use App\Support\Bibliography\Biblatex;
use App\Support\Bibliography\Suggestions;
use App\Support\DeletionImpact;
use App\Support\Edition\ConjectureCatalogue;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class WorkController extends Controller
{
    public function create(): Response
    {
        $this->authorize('create', Work::class);

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
            'user_id' => $request->user()->id,
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

        $work->setRelation('witnesses', $work->relatedWitnesses()->orderBy('siglum')->get());

        $transcriptions = TranscriptionLayer::forWork($work)
            ->visibleTo($request->user())
            ->with(['witness', 'user', 'transcription'])
            ->get();

        $work->setAttribute('deletion_impact', DeletionImpact::forWork($work));

        return Inertia::render('Works/Show', [
            'work' => $work,
            'can' => [
                'edit' => $request->user()?->can('update', $work) ?? false,
                'delete' => $request->user()?->can('delete', $work) ?? false,
                'createEdition' => $request->user()?->can('create', [Edition::class, $work]) ?? false,
            ],
            'transcriptions' => $transcriptions,
            // The work's whole stockpile of conjectures, of every kind, for
            // the list where they are recorded, edited and removed.
            'conjectures' => ConjectureCatalogue::forWork($work, $request->user()),
            'referenceLevels' => $work->referenceScheme->levels,
            'bibliographyForm' => [
                'registry' => Biblatex::registry(),
                'suggestions' => Suggestions::all(),
            ],
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
        $this->authorize('delete', $work);

        $work->delete();

        return redirect()->route('home');
    }
}
