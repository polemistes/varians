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
        return Inertia::render('Home', [
            'editions' => Edition::visibleTo($request->user())
                ->with('work:id,title,slug')
                ->orderBy('title')
                ->get(['id', 'work_id', 'title', 'visibility']),

            'works' => Work::visibleTo($request->user())
                ->withCount(['editions', 'transcriptionSegments'])
                ->orderBy('title')
                ->get(['id', 'title', 'slug', 'author']),

            'witnesses' => Witness::visibleTo($request->user())
                ->withCount('transcriptions')
                ->orderBy('siglum')
                ->get(['id', 'siglum', 'label', 'date_text']),
        ]);
    }
}
