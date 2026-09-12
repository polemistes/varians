<?php

namespace App\Http\Controllers;

use App\Models\Edition;
use App\Models\Witness;
use App\Models\Work;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class HomeController extends Controller
{
    /**
     * Everything the site holds, in three lists. This replaced the separate
     * works and witnesses index pages: they listed one category each and the
     * front page only counted them, so reaching anything took two clicks
     * through a page that said nothing.
     *
     * The counts are for the deletion warnings — what a work or a witness
     * takes with it. Loaded with withCount so the whole page stays a handful
     * of queries; the itemised preview (DeletionImpact) belongs on the item's
     * own page, where one row's worth of queries is affordable.
     */
    public function index(Request $request): Response
    {
        $user = $request->user();

        // Deleting is the owner's alone, and an edition is made on a work
        // one may edit — each row says so, so the page offers only what
        // the policies would allow.
        //
        // Every row also carries its owner and when it was made: a copy
        // keeps the original's title or siglum, so without those two the
        // lists show several identical entries (user report).
        return Inertia::render('Home', [
            // Every member may start a work, a witness, an edition of her own.
            'can' => ['create' => $user !== null],
            'editions' => Edition::visibleTo($user)
                ->with(['work:id,title,slug', 'user:id,name'])
                ->orderBy('title')
                ->get(['id', 'work_id', 'user_id', 'title', 'visibility', 'created_at'])
                ->each(fn (Edition $edition) => $edition->setAttribute('can_delete', $user?->can('delete', $edition) ?? false)),

            'works' => Work::visibleTo($user)
                ->with('user:id,name')
                ->withCount(['editions', 'transcriptionSegments'])
                ->orderBy('title')
                ->get(['id', 'user_id', 'title', 'slug', 'author', 'created_at'])
                ->each(function (Work $work) use ($user): void {
                    $work->setAttribute('can_edit', $user?->can('update', $work) ?? false);
                    $work->setAttribute('can_delete', $user?->can('delete', $work) ?? false);
                }),

            'witnesses' => Witness::visibleTo($user)
                ->with('user:id,name')
                ->withCount('transcriptions')
                ->orderBy('siglum')
                ->get(['id', 'user_id', 'siglum', 'label', 'date_text', 'created_at'])
                ->each(fn (Witness $witness) => $witness->setAttribute('can_delete', $user?->can('delete', $witness) ?? false)),
        ]);
    }
}
