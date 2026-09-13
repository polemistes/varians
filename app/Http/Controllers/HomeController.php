<?php

namespace App\Http\Controllers;

use App\Models\Edition;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use Illuminate\Database\Eloquent\Builder;
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
        $shared = $this->sharedWithViewer($user);

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
                ->each(function (Edition $edition) use ($user, $shared): void {
                    $edition->setAttribute('can_delete', $user?->can('delete', $edition) ?? false);
                    $edition->setAttribute('sharing', self::sharing($edition->user_id, $edition->id, $shared['editions'], $user));
                }),

            'works' => Work::visibleTo($user)
                ->with('user:id,name')
                ->withCount(['editions', 'assignments'])
                ->orderBy('title')
                ->get(['id', 'user_id', 'title', 'slug', 'author', 'created_at'])
                ->each(function (Work $work) use ($user, $shared): void {
                    $work->setAttribute('can_edit', $user?->can('update', $work) ?? false);
                    $work->setAttribute('can_delete', $user?->can('delete', $work) ?? false);
                    $work->setAttribute('sharing', self::sharing($work->user_id, $work->id, $shared['works'], $user));
                }),

            'witnesses' => Witness::visibleTo($user)
                ->with('user:id,name')
                ->withCount('transcriptions')
                ->orderBy('siglum')
                ->get(['id', 'user_id', 'siglum', 'label', 'date_text', 'created_at'])
                ->each(function (Witness $witness) use ($user, $shared): void {
                    $witness->setAttribute('can_delete', $user?->can('delete', $witness) ?? false);
                    $witness->setAttribute('sharing', self::sharing($witness->user_id, $witness->id, $shared['witnesses'], $user));
                }),
        ]);
    }

    /**
     * What each list is grouped by: the viewer's own, what has been shared
     * with her, and everything else she may see (user decision — a single
     * list said nothing about which was which).
     *
     * SHARED means shared with this member by name: she owns an edition of
     * the work, or was invited to edit one. It deliberately does not ask the
     * policies, which would answer yes to everything for a site-wide editor
     * or an administrator and leave them with one enormous "shared" group.
     * For those two, then, the third group is everything belonging to
     * someone else, published or not.
     *
     * @return array{editions: array<int, bool>, works: array<int, bool>, witnesses: array<int, bool>} ids, as lookups
     */
    private function sharedWithViewer(?User $user): array
    {
        if ($user === null) {
            return ['editions' => [], 'works' => [], 'witnesses' => []];
        }

        return [
            'editions' => array_fill_keys(Edition::query()->editableBy($user)->pluck('editions.id')->all(), true),
            'works' => array_fill_keys(Work::query()->editableBy($user)->pluck('works.id')->all(), true),
            // A witness is reached through the works its transcriptions
            // assign text to — editing privileges are granted on an
            // edition and travel from there (see WitnessPolicy).
            'witnesses' => array_fill_keys(
                Witness::query()
                    ->whereHas(
                        'transcriptionLayers.assignments.canonicalPassage',
                        fn (Builder $query) => $query->whereIn(
                            'work_id',
                            Work::query()->editableBy($user)->select('works.id')
                        )
                    )
                    ->pluck('witnesses.id')
                    ->all(),
                true
            ),
        ];
    }

    /**
     * @param  array<int, bool>  $shared
     */
    private static function sharing(?int $ownerId, int $id, array $shared, ?User $user): string
    {
        if ($user !== null && $ownerId === $user->id) {
            return 'own';
        }

        return isset($shared[$id]) ? 'shared' : 'public';
    }
}
