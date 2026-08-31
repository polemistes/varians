<?php

namespace App\Http\Controllers;

use App\Enums\ConjectureType;
use App\Http\Requests\StoreEditionRequest;
use App\Http\Requests\UpdateEditionRequest;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionComment;
use App\Models\EditionLemma;
use App\Models\EditionPassage;
use App\Models\EditionPassageOrder;
use App\Models\EditionTransposition;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\Transcription;
use App\Models\TranscriptionSegment;
use App\Models\Work;
use App\Support\Edition\PermutationBlocks;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection as SupportCollection;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class EditionController extends Controller
{
    /**
     * How many canonical passages the continuous-text view renders per page
     * — passages are typically one verse line each, so this keeps a page's
     * alignment/rendering work small without needing reference-scheme-aware
     * windowing.
     */
    private const WINDOW = 50;

    public function create(Work $work): Response
    {
        return Inertia::render('Editions/Create', ['work' => $work]);
    }

    public function store(StoreEditionRequest $request, Work $work): RedirectResponse
    {
        $edition = $work->editions()->create([
            'user_id' => $request->user()->id,
            'title' => $request->validated('title'),
            'description' => $request->validated('description'),
        ]);

        return redirect()->route('editions.show', [$work, $edition]);
    }

    public function show(Request $request, Work $work, Edition $edition): Response
    {
        $this->authorize('view', $edition);
        abort_unless($work->is($edition->work), 404);

        $editionPassages = EditionPassage::where('edition_id', $edition->id)
            ->orderBy('position')
            ->with(['canonicalPassage:id,label,sort_key,address', 'transcription.witness:id,siglum'])
            ->get();

        // Two independent, structurally different sources of reordering:
        // scholarly transpositions relocate a range elsewhere (Conjecture,
        // reusable, `proposed_by`-attributed — phase 1, unchanged), while
        // EditionPassageOrder resequences a range *in place* (phase 2,
        // sourced from either a transcription's own order or a catalogued
        // Reordering conjecture, see EditionPassageOrder for why a
        // witness-sourced choice is never itself a Conjecture). They don't
        // interact, so they're applied in two clean phases rather than one
        // merged chronological list.
        $adoptedConjectures = EditionTransposition::where('edition_id', $edition->id)
            ->with('conjecture')
            ->get()
            ->pluck('conjecture')
            ->filter();

        $passageOrders = EditionPassageOrder::where('edition_id', $edition->id)
            ->with('conjecture.orderingEntries')
            ->get();

        $relocated = $this->applyRelocations($editionPassages, $this->buildRelocationMoves($adoptedConjectures));
        $orderedPassages = $this->applyPassageOrders($relocated, $passageOrders);

        $totalPages = max(1, (int) ceil($orderedPassages->count() / self::WINDOW));
        $page = max(1, min($totalPages, (int) $request->query('page', 1)));
        $window = $orderedPassages->slice(($page - 1) * self::WINDOW, self::WINDOW)->values();

        // Loaded once and shared by the "Add text" panel prop below and by
        // orderRanges() — every transcription's own segments already carry
        // exactly the start_offset data a physical-order comparison needs,
        // so detection costs no extra query. Scoped to transcriptions this
        // viewer can actually see, same as the panel itself: a draft
        // transcription's own order must not leak to a non-editor via a
        // range marker either.
        //
        // Restricted to the collatable layer for both uses. The panel adds
        // text to an edition, which only a normalized transcription may
        // source. Ordering loses nothing by the same filter: a fork copies
        // the citation segments verbatim, so the normalized layer carries
        // the very same physical order its diplomatic parent does.
        $transcriptions = Transcription::forWork($work)->visibleTo($request->user())->collatable()
            ->with([
                'witness:id,siglum',
                'segments' => fn ($query) => $query->whereHas('canonicalPassage', fn ($q) => $q->where('work_id', $work->id)),
                'segments.canonicalPassage:id,work_id,address,sort_key,label',
            ])
            ->get(['id', 'witness_id', 'text']);

        $orderRanges = $this->orderRanges($window, $transcriptions, $passageOrders);

        return Inertia::render('Editions/Show', [
            'work' => $work->only(['id', 'title', 'slug']),
            'edition' => $edition,
            'page' => $page,
            'totalPages' => $totalPages,
            'passages' => $this->annotatePassageStatus($orderedPassages, $edition),
            'windowPassages' => $window->values()
                ->map(fn (EditionPassage $editionPassage, int $index) => $this->passageDetail($editionPassage, $edition, $orderRanges[$index] ?? null))
                ->values(),
            // The work's *entire* citation space, regardless of what's in
            // this edition yet — the bulk "base a range" picker searches a
            // citation range for segments to add, so it must be able to
            // name a range that isn't in the edition at all yet (unlike
            // `passages` above, which the transposition picker uses and is
            // deliberately scoped to what's already been added).
            'workPassages' => $work->canonicalPassages()->orderBy('sort_key')->get(['id', 'address']),
            'transpositions' => EditionTransposition::where('edition_id', $edition->id)
                ->with([
                    'conjecture.canonicalPassage:id,label',
                    'conjecture.transpositionRangeEnd:id,label',
                    'conjecture.moveTarget:id,label',
                    'conjecture.user:id,name',
                ])
                ->get()
                ->map(fn (EditionTransposition $adoption) => [
                    'id' => $adoption->id,
                    'from_label' => $adoption->conjecture->canonicalPassage->label,
                    'to_label' => $adoption->conjecture->transpositionRangeEnd->label ?? null,
                    'target_label' => $adoption->conjecture->moveTarget->label,
                    'move_position' => $adoption->conjecture->move_position,
                    'proposed_by' => $adoption->conjecture->proposed_by ?? $adoption->conjecture->user->name,
                ])->values(),
            // Each transcription's own text/segments, for the "Add text"
            // panel's tabbed selection view — scoped to segments citing
            // *this* work, since a transcription can carry citations into
            // more than one work.
            'transcriptions' => $transcriptions,
            'referenceLevels' => $work->referenceScheme->levels,
        ]);
    }

    public function update(UpdateEditionRequest $request, Edition $edition): RedirectResponse
    {
        $edition->update($request->validated());

        return back();
    }

    public function destroy(Edition $edition): RedirectResponse
    {
        $work = $edition->work;
        $edition->delete();

        return redirect()->route('works.show', $work);
    }

    /**
     * Phase 1: relocation — an edition's own passage order can float free
     * of manuscript order, exactly like a single transcription's physical
     * order can already diverge from citation numbering, by applying
     * adopted scholarly transpositions that shift a range of passages to
     * sit before/after another one. Applied sequentially in adoption order;
     * a target itself moved away by an earlier move, or a passage removed
     * from the edition since, is left unresolved rather than losing its
     * range (a rare, self-inflicted conflict this doesn't try to untangle
     * further) — a transposition is never deleted just because a passage
     * it names is no longer in the edition, see
     * EditionPassageController::destroy. Phase 2 (internal reordering, see
     * applyPassageOrders()) runs afterward and doesn't interact with this:
     * relocation moves a range elsewhere, reordering only resequences one
     * in place.
     *
     * @param  SupportCollection<int, EditionPassage>  $passages
     * @param  array<int, array{canonical_passage_id: int, transposition_range_end_canonical_passage_id: int|null, move_target_canonical_passage_id: int|null, move_position: string|null}>  $moves
     * @return SupportCollection<int, EditionPassage>
     */
    private function applyRelocations(SupportCollection $passages, array $moves): SupportCollection
    {
        $ordered = $passages->values()->all();

        foreach ($moves as $move) {
            $ordered = $this->moveRange($ordered, $move);
        }

        return collect($ordered);
    }

    /**
     * @param  SupportCollection<int, Conjecture>  $adoptedConjectures
     * @return array<int, array{canonical_passage_id: int, transposition_range_end_canonical_passage_id: int|null, move_target_canonical_passage_id: int|null, move_position: string|null}>
     */
    private function buildRelocationMoves(SupportCollection $adoptedConjectures): array
    {
        return $adoptedConjectures
            ->sortBy('created_at')
            ->map(fn (Conjecture $conjecture) => [
                'canonical_passage_id' => $conjecture->canonical_passage_id,
                'transposition_range_end_canonical_passage_id' => $conjecture->transposition_range_end_canonical_passage_id,
                'move_target_canonical_passage_id' => $conjecture->move_target_canonical_passage_id,
                'move_position' => $conjecture->move_position,
            ])
            ->values()
            ->all();
    }

    /**
     * Phase 2: internal reordering — resequences a range's own passages in
     * place, never moving the range itself (that's relocation, phase 1,
     * see applyRelocations()). For each EditionPassageOrder, finds the
     * range's current array slots (by EditionPassage.position — stable and
     * unchanged by phase 1, which only ever reorders array slots, never
     * position values, exactly like this phase), and reassigns those same
     * slots to hold the passages in the chosen source's own sequence (a
     * transcription's own segment order, or a conjecture's orderingEntries)
     * — the block's own overall position span never moves, only what sits
     * at each slot within it.
     *
     * @param  SupportCollection<int, EditionPassage>  $passages
     * @param  SupportCollection<int, EditionPassageOrder>  $passageOrders
     * @return SupportCollection<int, EditionPassage>
     */
    private function applyPassageOrders(SupportCollection $passages, SupportCollection $passageOrders): SupportCollection
    {
        $ordered = $passages->values()->all();

        foreach ($passageOrders as $passageOrder) {
            $ordered = $this->applyPassageOrder($ordered, $passageOrder);
        }

        return collect($ordered);
    }

    /**
     * @param  array<int, EditionPassage>  $passages
     * @return array<int, EditionPassage>
     */
    private function applyPassageOrder(array $passages, EditionPassageOrder $passageOrder): array
    {
        $startPosition = null;
        $endPosition = null;

        foreach ($passages as $passage) {
            if ($passage->canonical_passage_id === $passageOrder->range_start_canonical_passage_id) {
                $startPosition = (float) $passage->position;
            }

            if ($passage->canonical_passage_id === $passageOrder->range_end_canonical_passage_id) {
                $endPosition = (float) $passage->position;
            }
        }

        if ($startPosition === null || $endPosition === null) {
            return $passages;
        }

        if ($endPosition < $startPosition) {
            [$startPosition, $endPosition] = [$endPosition, $startPosition];
        }

        $spanIndexes = [];
        $canonicalPassageIds = [];

        foreach ($passages as $index => $passage) {
            $position = (float) $passage->position;

            if ($position >= $startPosition && $position <= $endPosition) {
                $spanIndexes[] = $index;
                $canonicalPassageIds[] = $passage->canonical_passage_id;
            }
        }

        $newSequence = $this->resolveOrderSequence($passageOrder, $canonicalPassageIds);

        if ($newSequence === null) {
            return $passages;
        }

        $byCanonicalPassageId = [];

        foreach ($spanIndexes as $index) {
            $byCanonicalPassageId[$passages[$index]->canonical_passage_id] = $passages[$index];
        }

        foreach ($spanIndexes as $slot => $index) {
            $passages[$index] = $byCanonicalPassageId[$newSequence[$slot]];
        }

        return $passages;
    }

    /**
     * The chosen source's own sequence of canonical_passage_ids for
     * exactly this range — a transcription's own segment order, or a
     * conjecture's orderingEntries — or null if it doesn't resolve to
     * *exactly* this range's own passage set any more (defensive; the
     * request layer already validates this at creation time, but data can
     * drift, e.g. a passage later removed from the edition).
     *
     * @param  array<int, int>  $canonicalPassageIds  the exact set this range currently covers, unordered
     * @return array<int, int>|null
     */
    private function resolveOrderSequence(EditionPassageOrder $passageOrder, array $canonicalPassageIds): ?array
    {
        if ($passageOrder->conjecture_id !== null) {
            $sequence = $passageOrder->conjecture?->orderingEntries->pluck('canonical_passage_id')->all();
        } elseif ($passageOrder->transcription_id !== null) {
            $sequence = TranscriptionSegment::where('transcription_id', $passageOrder->transcription_id)
                ->whereIn('canonical_passage_id', $canonicalPassageIds)
                ->orderBy('start_offset')
                ->pluck('canonical_passage_id')
                ->unique()
                ->values()
                ->all();
        } else {
            return null;
        }

        if ($sequence === null) {
            return null;
        }

        $sortedSequence = $sequence;
        sort($sortedSequence);
        $sortedExpected = $canonicalPassageIds;
        sort($sortedExpected);

        return $sortedSequence === $sortedExpected ? $sequence : null;
    }

    /**
     * Finds the transposed range/target by EditionPassage.position — a
     * stable value that never changes for an already-added passage (only a
     * freshly-added one ever gets a new position), the same property
     * citation sort_key used to have and still needs here: a subsequent
     * move's own range is found by value, not by array position, so it
     * still finds its passages correctly no matter how an earlier move in
     * this same pass reshuffled the array.
     *
     * Takes a plain shape rather than a `Conjecture` directly — a move can
     * come from a scholarly transposition or from an `EditionPassageOrder`
     * witness choice equally, see applyTranspositions(). `move_target_*`/
     * `move_position` are typed nullable only because `Conjecture`'s own
     * columns are (every *other* conjecture type leaves them null) — a
     * `Conjecture` reaching here is always type=transposition in practice
     * (see buildMoves()), so this bails defensively rather than asserting.
     *
     * @param  array<int, EditionPassage>  $passages
     * @param  array{canonical_passage_id: int, transposition_range_end_canonical_passage_id: int|null, move_target_canonical_passage_id: int|null, move_position: string|null}  $move
     * @return array<int, EditionPassage>
     */
    private function moveRange(array $passages, array $move): array
    {
        $moveTargetId = $move['move_target_canonical_passage_id'];
        $movePosition = $move['move_position'];

        if ($moveTargetId === null || $movePosition === null) {
            return $passages;
        }

        $fromPosition = null;
        $toPosition = null;
        $rangeEndId = $move['transposition_range_end_canonical_passage_id'] ?? $move['canonical_passage_id'];

        foreach ($passages as $passage) {
            if ($passage->canonical_passage_id === $move['canonical_passage_id']) {
                $fromPosition = (float) $passage->position;
            }

            if ($passage->canonical_passage_id === $rangeEndId) {
                $toPosition = (float) $passage->position;
            }
        }

        if ($fromPosition === null || $toPosition === null) {
            return $passages;
        }

        if ($toPosition < $fromPosition) {
            [$fromPosition, $toPosition] = [$toPosition, $fromPosition];
        }

        $moved = [];
        $remaining = [];

        foreach ($passages as $passage) {
            $position = (float) $passage->position;

            if ($position >= $fromPosition && $position <= $toPosition) {
                $moved[] = $passage;
            } else {
                $remaining[] = $passage;
            }
        }

        $targetIndex = null;

        foreach ($remaining as $index => $passage) {
            if ($passage->canonical_passage_id === $moveTargetId) {
                $targetIndex = $index;

                break;
            }
        }

        if ($targetIndex === null) {
            return $passages;
        }

        $insertAt = $movePosition === 'before' ? $targetIndex : $targetIndex + 1;
        array_splice($remaining, $insertAt, 0, $moved);

        return $remaining;
    }

    /**
     * Notices what no one asked it to: for the edition's *current* order
     * (after all applied moves — relocation and internal reordering both),
     * which contiguous, self-contained blocks of passages some other
     * transcription's own physical order rearranges relative to it — see
     * PermutationBlocks for the decomposition itself, which is a strict
     * generalization of a plain adjacent swap (the smallest possible
     * non-identity block is size 2). Blocks from different transcriptions
     * are merged wherever they overlap, since only one candidate list makes
     * sense for one span of the edition's text. A transcription that
     * doesn't cite every passage in the final merged range can't offer a
     * whole-range candidate (mirrors how a fragmentary witness already
     * can't extend past what it covers elsewhere, see witnessExtension()) —
     * it simply isn't listed as a candidate for that range.
     *
     * A range already settled by an EditionPassageOrder choice keeps
     * showing (with that row's id, so the frontend can offer to undo it)
     * even once nothing disagrees with it any more — otherwise a settled
     * choice would vanish the moment it stopped being disputed, with no way
     * back to it. This operates purely on the *final* order, so a
     * relocation (phase 1) that happens to resolve a disagreement already
     * shows up here as "nothing to flag" with no separate suppression logic
     * needed — unlike the old adjacent-pair version, a relocation that
     * *doesn't* fully resolve a disagreement against some other witness is
     * now correctly still flagged, rather than being blanket-suppressed
     * just because a transposition touched the area.
     *
     * @param  SupportCollection<int, EditionPassage>  $window
     * @param  SupportCollection<int, Transcription>  $transcriptions  Each with `segments` (and `segments.canonicalPassage`) and `witness` already eager-loaded — see show().
     * @param  SupportCollection<int, EditionPassageOrder>  $passageOrders  Each with `conjecture.orderingEntries` already eager-loaded — see show().
     * @return array<int, array{range_key: string, range_start_canonical_passage_id: int, range_end_canonical_passage_id: int, edition_passage_order_id: int|null, candidates: array<int, array<string, mixed>>}>
     */
    private function orderRanges(SupportCollection $window, SupportCollection $transcriptions, SupportCollection $passageOrders): array
    {
        $ordered = $window->values();
        $indexBlocks = [];

        foreach ($transcriptions as $transcription) {
            $offsetsByPassageId = $transcription->segments
                ->groupBy('canonical_passage_id')
                ->map(fn (SupportCollection $segments) => $segments->min('start_offset'));

            $citedIndexes = [];

            foreach ($ordered as $index => $editionPassage) {
                if ($offsetsByPassageId->has($editionPassage->canonical_passage_id)) {
                    $citedIndexes[] = $index;
                }
            }

            if (count($citedIndexes) < 2) {
                continue;
            }

            $sortedByOffset = collect($citedIndexes)
                ->sortBy(fn (int $index) => $offsetsByPassageId->get($ordered[$index]->canonical_passage_id))
                ->values();

            $rankOf = [];

            foreach ($sortedByOffset as $rank => $editionIndex) {
                $rankOf[$editionIndex] = $rank;
            }

            $perm = [];

            foreach ($citedIndexes as $local => $editionIndex) {
                $perm[$local] = $rankOf[$editionIndex];
            }

            foreach (PermutationBlocks::nonIdentityBlocks($perm) as [$localStart, $localEnd]) {
                $indexBlocks[] = [$citedIndexes[$localStart], $citedIndexes[$localEnd]];
            }
        }

        $positionByCanonicalPassageId = [];

        foreach ($ordered as $editionPassage) {
            $positionByCanonicalPassageId[$editionPassage->canonical_passage_id] = (float) $editionPassage->position;
        }

        // Each EditionPassageOrder's own *current* index-span, computed once
        // here — reused both to seed detection (so a settled range with no
        // more disagreement still shows) and to recognize it later. We locate
        // the span via the range's stable *positions* (never mutated by
        // resequencing — see applyPassageOrder()), then scan for every
        // passage whose position falls inside, exactly like applyPassageOrder
        // itself does. Looking up the two named boundary passages' *current
        // array indices* is not enough once a range has more than two
        // members: resequencing can put a passage that isn't either named
        // boundary at the new lowest/highest index, leaving the span
        // computed from just the two boundary ids too narrow.
        $settledSpans = [];

        foreach ($passageOrders as $passageOrder) {
            $startPosition = $positionByCanonicalPassageId[$passageOrder->range_start_canonical_passage_id] ?? null;
            $endPosition = $positionByCanonicalPassageId[$passageOrder->range_end_canonical_passage_id] ?? null;

            if ($startPosition === null || $endPosition === null) {
                continue;
            }

            if ($endPosition < $startPosition) {
                [$startPosition, $endPosition] = [$endPosition, $startPosition];
            }

            $spanIndexes = [];

            foreach ($ordered as $index => $editionPassage) {
                $position = (float) $editionPassage->position;

                if ($position >= $startPosition && $position <= $endPosition) {
                    $spanIndexes[] = $index;
                }
            }

            if ($spanIndexes === []) {
                continue;
            }

            $span = [min($spanIndexes), max($spanIndexes)];
            $settledSpans[] = ['order' => $passageOrder, 'span' => $span];
            $indexBlocks[] = $span;
        }

        $ranges = [];

        foreach ($this->mergeIndexBlocks($indexBlocks) as [$startIndex, $endIndex]) {
            $settlingOrder = null;

            foreach ($settledSpans as $entry) {
                if ($entry['span'] === [$startIndex, $endIndex]) {
                    $settlingOrder = $entry['order'];

                    break;
                }
            }

            $rangeInfo = $this->buildOrderRangeInfo($ordered, $startIndex, $endIndex, $transcriptions, $settlingOrder);

            if ($rangeInfo === null) {
                continue;
            }

            for ($i = $startIndex; $i <= $endIndex; $i++) {
                $ranges[$i] = $rangeInfo;
            }
        }

        return $ranges;
    }

    /**
     * Standard interval-union merge — blocks that only touch (adjacent, not
     * overlapping) stay separate, since each is already self-contained on
     * its own; only genuine overlap forces a merge.
     *
     * @param  array<int, array{0: int, 1: int}>  $blocks
     * @return array<int, array{0: int, 1: int}>
     */
    private function mergeIndexBlocks(array $blocks): array
    {
        usort($blocks, fn (array $a, array $b) => $a[0] <=> $b[0]);

        $merged = [];

        foreach ($blocks as [$start, $end]) {
            $last = count($merged) - 1;

            if ($last >= 0 && $start <= $merged[$last][1]) {
                $merged[$last][1] = max($merged[$last][1], $end);
            } else {
                $merged[] = [$start, $end];
            }
        }

        return $merged;
    }

    /**
     * @param  SupportCollection<int, EditionPassage>  $ordered
     * @param  SupportCollection<int, Transcription>  $transcriptions
     * @return array{range_key: string, range_start_canonical_passage_id: int, range_end_canonical_passage_id: int, edition_passage_order_id: int|null, candidates: array<int, array<string, mixed>>}|null
     */
    private function buildOrderRangeInfo(SupportCollection $ordered, int $startIndex, int $endIndex, SupportCollection $transcriptions, ?EditionPassageOrder $settlingOrder): ?array
    {
        $rangePassages = $ordered->slice($startIndex, $endIndex - $startIndex + 1)->values();
        $canonicalPassageIds = $rangePassages->pluck('canonical_passage_id')->all();
        $labelByPassageId = $rangePassages->keyBy('canonical_passage_id');

        $startPassageId = $ordered[$startIndex]->canonical_passage_id;
        $endPassageId = $ordered[$endIndex]->canonical_passage_id;

        $candidates = [];

        foreach ($transcriptions as $transcription) {
            $citedIds = $transcription->segments->pluck('canonical_passage_id')->unique();

            if ($citedIds->intersect($canonicalPassageIds)->count() !== count($canonicalPassageIds)) {
                continue; // fragmentary — doesn't cite every passage in the range
            }

            $sequence = $transcription->segments
                ->whereIn('canonical_passage_id', $canonicalPassageIds)
                ->groupBy('canonical_passage_id')
                ->map(fn (SupportCollection $segments) => $segments->min('start_offset'))
                ->sortBy(fn (int $offset) => $offset)
                ->keys()
                ->all();

            $candidates[] = [
                'source' => 'transcription',
                'transcription_id' => $transcription->id,
                'conjecture_id' => null,
                'proposed_by' => null,
                'sequence' => collect($sequence)->map(fn (int $id) => $labelByPassageId->get($id)?->canonicalPassage->label)->all(),
                'witness_siglum' => $transcription->witness->siglum,
                'matches_current' => $sequence === $canonicalPassageIds,
            ];
        }

        $reorderingConjectures = Conjecture::where('type', ConjectureType::Reordering)
            ->whereHas('orderingEntries', fn ($query) => $query->whereIn('canonical_passage_id', $canonicalPassageIds))
            ->with(['orderingEntries', 'user:id,name'])
            ->get()
            ->filter(function (Conjecture $conjecture) use ($canonicalPassageIds) {
                $proposedIds = $conjecture->orderingEntries->pluck('canonical_passage_id')->sort()->values()->all();
                $expectedIds = collect($canonicalPassageIds)->sort()->values()->all();

                return $proposedIds === $expectedIds;
            });

        foreach ($reorderingConjectures as $conjecture) {
            $sequenceIds = $conjecture->orderingEntries->pluck('canonical_passage_id')->all();

            $candidates[] = [
                'source' => 'conjecture',
                'transcription_id' => null,
                'conjecture_id' => $conjecture->id,
                'proposed_by' => $conjecture->proposed_by ?? $conjecture->user->name,
                'sequence' => collect($sequenceIds)->map(fn (int $id) => $labelByPassageId->get($id)?->canonicalPassage->label)->all(),
                'witness_siglum' => null,
                'matches_current' => $sequenceIds === $canonicalPassageIds,
            ];
        }

        $hasAlternative = collect($candidates)->contains(fn (array $candidate) => ! $candidate['matches_current']);

        if (! $hasAlternative && $settlingOrder === null) {
            return null;
        }

        return [
            'range_key' => "{$startPassageId}-{$endPassageId}",
            'range_start_canonical_passage_id' => $startPassageId,
            'range_end_canonical_passage_id' => $endPassageId,
            'edition_passage_order_id' => $settlingOrder?->id,
            'candidates' => $candidates,
        ];
    }

    /**
     * Only `partial`/`complete` remain reachable now — a passage is only
     * ever in this list because it was added (materialized + base-selected
     * at add time, see PassageAdder), so `no_base`/`untouched`/`needs_review`
     * can no longer occur.
     *
     * @param  SupportCollection<int, EditionPassage>  $passages
     * @return array<int, array<string, mixed>>
     */
    private function annotatePassageStatus(SupportCollection $passages, Edition $edition): array
    {
        $passageIds = $passages->pluck('canonical_passage_id');

        $lemmaCounts = DB::table('lemmas')
            ->whereIn('canonical_passage_id', $passageIds)
            ->selectRaw('canonical_passage_id, COUNT(*) as total')
            ->groupBy('canonical_passage_id')
            ->get()
            ->keyBy('canonical_passage_id');

        // A single EditionLemma row can now claim more than one lemma
        // position (a range-shaped selection — see LemmaReading's
        // range_end_lemma_id), so "resolved" has to count every *lemma*
        // covered by a selection, not every selection row, or a passage
        // fully decided via one range would stay stuck at "partial"
        // forever. The join expands each selection across its own
        // [start.position, end.position] span (a plain, non-range
        // selection's span is just its own single position) before
        // counting distinct covered lemma ids.
        $selectedCounts = DB::table('edition_lemmas')
            ->join('lemma_readings', 'lemma_readings.id', '=', 'edition_lemmas.selected_reading_id')
            ->join('lemmas as start_lemma', 'start_lemma.id', '=', 'edition_lemmas.lemma_id')
            ->leftJoin('lemmas as end_lemma', 'end_lemma.id', '=', 'lemma_readings.range_end_lemma_id')
            ->join('lemmas', function ($join) {
                $join->on('lemmas.canonical_passage_id', '=', 'start_lemma.canonical_passage_id')
                    ->where('lemmas.position', '>=', DB::raw('start_lemma.position'))
                    ->where('lemmas.position', '<=', DB::raw('COALESCE(end_lemma.position, start_lemma.position)'));
            })
            ->where('edition_lemmas.edition_id', $edition->id)
            ->whereIn('start_lemma.canonical_passage_id', $passageIds)
            ->selectRaw('start_lemma.canonical_passage_id, COUNT(DISTINCT lemmas.id) as resolved')
            ->groupBy('start_lemma.canonical_passage_id')
            ->get()
            ->keyBy('canonical_passage_id');

        return $passages->values()->map(function (EditionPassage $editionPassage, int $index) use ($lemmaCounts, $selectedCounts): array {
            $passage = $editionPassage->canonicalPassage;
            $total = (int) ($lemmaCounts->get($passage->id)->total ?? 0);
            $resolved = (int) ($selectedCounts->get($passage->id)->resolved ?? 0);

            return [
                'id' => $passage->id,
                'label' => $passage->label,
                'sort_key' => $passage->sort_key,
                'address' => $passage->address,
                'status' => $total === $resolved ? 'complete' : 'partial',
                'page' => intdiv($index, self::WINDOW) + 1,
            ];
        })->all();
    }

    /**
     * @param  array{range_key: string, range_start_canonical_passage_id: int, range_end_canonical_passage_id: int, edition_passage_order_id: int|null, candidates: array<int, array<string, mixed>>}|null  $orderRange
     * @return array<string, mixed>
     */
    private function passageDetail(EditionPassage $editionPassage, Edition $edition, ?array $orderRange): array
    {
        $passage = $editionPassage->canonicalPassage;
        $base = $editionPassage->transcription;

        return [
            'id' => $passage->id,
            'edition_passage_id' => $editionPassage->id,
            'label' => $passage->label,
            'order_range' => $orderRange,
            'base' => $base !== null ? [
                'transcription_id' => $base->id,
                'witness_siglum' => $base->witness->siglum,
            ] : null,
            'runs' => $this->materializedRuns($passage, $base, $edition),
            // This edition's own notes here — see EditionComment. An
            // unanchored one (lemma_id null) is about the whole passage.
            'comments' => EditionComment::where('edition_id', $edition->id)
                ->where('canonical_passage_id', $passage->id)
                ->with('user:id,name')
                ->orderBy('id')
                ->get()
                ->map(fn (EditionComment $comment) => [
                    'id' => $comment->id,
                    'lemma_id' => $comment->lemma_id,
                    'range_end_lemma_id' => $comment->range_end_lemma_id,
                    'note' => $comment->note,
                    'author' => $comment->user->name,
                ])->values(),
            'unplacedConjectures' => Conjecture::where('canonical_passage_id', $passage->id)
                ->whereIn('type', [ConjectureType::Substitution, ConjectureType::Lacuna, ConjectureType::Supplement])
                ->whereDoesntHave('lemmaReadings')
                ->with('user:id,name')
                ->get()
                ->map(fn (Conjecture $conjecture) => [
                    'id' => $conjecture->id,
                    'type' => $conjecture->type->value,
                    'supplements_conjecture_id' => $conjecture->supplements_conjecture_id,
                    'label' => $this->conjectureLabel($conjecture),
                    'text' => $this->conjectureDisplayText($conjecture),
                    'note' => $conjecture->note,
                    'bibliography' => $conjecture->bibliography,
                ])->values(),
        ];
    }

    /**
     * An index-walk rather than a plain per-lemma map, since a selected
     * reading can now claim more than its own lemma (see LemmaReading's
     * range_end_lemma_id) — when it does, this jumps the walk straight past
     * every lemma it covers, which are never independently rendered while
     * covered (their own readings/selections, if any, simply aren't
     * reached — see materializedRangeRun). `$base` is null only for a
     * whole-line lacuna (no manuscript witness at all, see
     * EditionVariantController::storeWholeLineLacuna) — every reading
     * lookup below tolerates that via baseReadingOf().
     *
     * @return array<int, array<string, mixed>>
     */
    private function materializedRuns(CanonicalPassage $passage, ?Transcription $base, Edition $edition): array
    {
        $lemmas = Lemma::where('canonical_passage_id', $passage->id)
            ->orderBy('position')
            ->with([
                'readings.transcription:id,witness_id,text',
                'readings.transcription.witness:id,siglum',
                'readings.conjecture.user:id,name',
            ])
            ->get()
            ->values();

        $selections = EditionLemma::where('edition_id', $edition->id)
            ->whereIn('lemma_id', $lemmas->pluck('id'))
            ->with('selectedReading')
            ->get()
            ->keyBy('lemma_id');

        $byId = $lemmas->keyBy('id');

        // A lacuna (or any zero-width inserted column) has no reading of
        // its own anchored to the base transcription — its position in the
        // base's coordinate space is inherited from whichever real word
        // last preceded it.
        $lastBaseEnd = null;
        $runs = [];
        $index = 0;

        while ($index < $lemmas->count()) {
            $lemma = $lemmas[$index];
            $selection = $selections->get($lemma->id);
            $endLemmaId = $selection?->selectedReading?->range_end_lemma_id;
            $rangeEndLemma = $endLemmaId !== null ? $byId->get($endLemmaId) : null;

            if ($rangeEndLemma !== null) {
                $runs[] = $this->materializedRangeRun($lemma, $rangeEndLemma, $selection, $base, $byId);
                $endReading = $this->baseReadingOf($rangeEndLemma, $base);
                $lastBaseEnd = $endReading->end_offset ?? $lastBaseEnd;
                $index = $lemmas->search(fn (Lemma $candidate) => $candidate->id === $rangeEndLemma->id) + 1;

                continue;
            }

            // The base's own reading can span further columns too, quite
            // apart from any selection: it does whenever the base was aligned
            // *into* columns some other witness's wording had already set
            // (see LemmaReading's range_end_lemma_id). Those covered columns
            // hold no reading of the base's at all, so rendering them
            // independently would splice other witnesses' words into this
            // edition's printed text — producing a line no manuscript
            // attests. Jump past them exactly as the selection branch above
            // does.
            $baseReading = $this->baseReadingOf($lemma, $base);
            $baseRangeEnd = $baseReading?->range_end_lemma_id !== null
                ? $byId->get($baseReading->range_end_lemma_id)
                : null;

            $runs[] = $this->materializedSingleRun($lemma, $selection, $base, $lastBaseEnd, $byId, $baseRangeEnd);
            $lastBaseEnd = $baseReading->end_offset ?? $lastBaseEnd;

            $coveredUntil = $baseRangeEnd !== null
                ? $lemmas->search(fn (Lemma $candidate) => $candidate->id === $baseRangeEnd->id)
                : false;

            $index = $coveredUntil !== false ? $coveredUntil + 1 : $index + 1;
        }

        return $runs;
    }

    /**
     * The base transcription's own reading on a lemma, if any — null
     * whenever `$base` itself is null (a whole-line lacuna has no base
     * transcription at all), never a bare `null === null` false match
     * against a conjecture reading's own null transcription_id.
     */
    private function baseReadingOf(Lemma $lemma, ?Transcription $base): ?LemmaReading
    {
        if ($base === null) {
            return null;
        }

        return $lemma->readings->first(fn (LemmaReading $reading) => $reading->transcription_id === $base->id);
    }

    /**
     * @param  SupportCollection<int, Lemma>  $byId
     * @param  Lemma|null  $baseRangeEnd  last column the base's own reading here covers, when it spans more than this one
     * @return array<string, mixed>
     */
    private function materializedSingleRun(Lemma $lemma, ?EditionLemma $selection, ?Transcription $base, ?int $lastBaseEnd, SupportCollection $byId, ?Lemma $baseRangeEnd = null): array
    {
        $selectedReadingId = $selection->selected_reading_id ?? null;
        $baseReading = $this->baseReadingOf($lemma, $base);

        $candidates = $this->materializedCandidates($lemma, $selectedReadingId, $base, $byId);

        // With nothing selected the base's own wording stands. Where the base
        // has no reading here it prints *nothing* and the run is a gap: a
        // witness that omits a word the others have must not be made to say
        // another manuscript's word for it. Only a passage with no base
        // transcription at all (a whole-line lacuna, see
        // EditionVariantController::storeWholeLineLacuna) falls back to a
        // candidate, having no base to speak for it.
        $selectedCandidate = $candidates->first(fn (array $candidate) => $candidate['selected']);
        $isGap = $selectedCandidate === null && $baseReading === null && $base !== null;

        $text = $selectedCandidate['text']
            ?? match (true) {
                $baseReading !== null => mb_substr($baseReading->transcription->text, $baseReading->start_offset, $baseReading->end_offset - $baseReading->start_offset),
                $isGap => '',
                default => $candidates->first()['text'] ?? '',
            };

        $baseStart = $baseReading->start_offset ?? $lastBaseEnd;
        $baseEnd = $baseReading->end_offset ?? $lastBaseEnd;

        return [
            'lemma_id' => $lemma->id,
            // Reported so the client knows this run answers for more than its
            // own column when the base's wording spans several.
            'range_end_lemma_id' => $baseRangeEnd?->id,
            'base_start' => $baseStart,
            'base_end' => $baseEnd,
            'text' => $text,
            'decided' => $selectedReadingId !== null,
            'gap' => $isGap,
            'candidates' => $candidates->all(),
            'extent_characters' => $selectedCandidate['extent_characters'] ?? null,
        ];
    }

    /**
     * A run collapsed from several existing lemmas into one, because the
     * currently-selected reading spans them (an editor's multi-word
     * conjecture, or a witness's own reading PassageAligner determined
     * doesn't decompose word-for-word — see LemmaReading::range_end_lemma_id).
     * Candidates are every reading on the *anchor* lemma, unfiltered by
     * their own range — a differently-shaped alternative (a different
     * range_end, or a plain single-word reading) is just as valid a
     * candidate to switch to as an identically-shaped one.
     *
     * @param  SupportCollection<int, Lemma>  $byId
     * @return array<string, mixed>
     */
    private function materializedRangeRun(Lemma $startLemma, Lemma $endLemma, EditionLemma $selection, ?Transcription $base, SupportCollection $byId): array
    {
        $candidates = $this->materializedCandidates($startLemma, $selection->selected_reading_id, $base, $byId);
        $selectedCandidate = $candidates->first(fn (array $candidate) => $candidate['selected']);

        $startReading = $this->baseReadingOf($startLemma, $base);
        $endReading = $this->baseReadingOf($endLemma, $base);

        return [
            'lemma_id' => $startLemma->id,
            'range_end_lemma_id' => $endLemma->id,
            'base_start' => $startReading->start_offset ?? null,
            'base_end' => $endReading->end_offset ?? null,
            'text' => $selectedCandidate['text'] ?? '',
            'decided' => true,
            'gap' => false,
            'candidates' => $candidates->all(),
            'extent_characters' => null,
        ];
    }

    /**
     * A column's candidates in apparatus order: the base's own reading, then
     * the other witnesses by siglum, then conjectures oldest first.
     *
     * Ordered explicitly because `readings` is a bare hasMany — left alone,
     * candidates come out in whatever order they were created, which is the
     * order the witnesses happened to be aligned in. That is incidental, not
     * evidence, and it made the apparatus's own reading order depend on which
     * witness first touched the passage.
     *
     * @param  SupportCollection<int, Lemma>  $byId
     * @return SupportCollection<int, array<string, mixed>>
     */
    private function materializedCandidates(Lemma $lemma, ?int $selectedReadingId, ?Transcription $base, SupportCollection $byId): SupportCollection
    {
        $referenceEnd = $this->widestRangeEnd($lemma, $byId);

        return $lemma->readings
            ->sortBy(fn (LemmaReading $reading): string => match (true) {
                $base !== null && $reading->transcription_id === $base->id => '0',
                $reading->transcription_id !== null => '1'.$reading->transcription->witness->siglum,
                default => '2'.str_pad((string) $reading->id, 12, '0', STR_PAD_LEFT),
            })
            ->map(
                fn (LemmaReading $reading): array => $this->materializedCandidate($reading, $selectedReadingId, $lemma, $base, $byId, $referenceEnd)
            )->values();
    }

    /**
     * The widest range any of this lemma's own readings already spans —
     * shared by every plain witness reading's own extension (see
     * witnessExtension), so an editor comparing a conjecture against what
     * a manuscript actually reads sees each manuscript's full competing
     * phrase, not just its first word.
     *
     * @param  SupportCollection<int, Lemma>  $byId
     */
    private function widestRangeEnd(Lemma $lemma, SupportCollection $byId): ?Lemma
    {
        return $lemma->readings
            ->pluck('range_end_lemma_id')
            ->filter()
            ->map(fn (int $id) => $byId->get($id))
            ->filter()
            ->sortByDesc(fn (Lemma $end) => (float) $end->position)
            ->first();
    }

    /**
     * `replaced_text` names the original span a range-shaped candidate
     * would consume if picked — the base witness's own wording from the
     * anchor lemma through the range's end, computed once here since a
     * plain single-word candidate (`range_end_lemma_id` null) needs no
     * such disambiguation: the run it's already offered on *is* its whole
     * scope.
     *
     * @param  SupportCollection<int, Lemma>  $byId
     * @return array<string, mixed>
     */
    private function materializedCandidate(LemmaReading $reading, ?int $selectedReadingId, Lemma $anchor, ?Transcription $base, SupportCollection $byId, ?Lemma $referenceEnd): array
    {
        $replacedText = $this->replacedSpanText($reading, $anchor, $base, $byId);
        $extension = $this->witnessExtension($reading, $anchor, $referenceEnd);

        if ($reading->transcription_id !== null) {
            return [
                'key' => 'reading:'.$reading->id,
                'label' => $reading->transcription->witness->siglum,
                'text' => $extension['text'] ?? mb_substr($reading->transcription->text, $reading->start_offset, $reading->end_offset - $reading->start_offset),
                'selected' => $reading->id === $selectedReadingId,
                'reading_id' => $reading->id,
                'transcription_id' => $reading->transcription_id,
                'start_offset' => $reading->start_offset,
                'end_offset' => $extension['end_offset'] ?? $reading->end_offset,
                'conjecture_id' => null,
                'conjecture_type' => null,
                'supplements_conjecture_id' => null,
                'bibliography' => null,
                'note' => null,
                'range_end_lemma_id' => $extension['range_end_lemma_id'] ?? $reading->range_end_lemma_id,
                'replaced_text' => $replacedText,
                'extent_characters' => null,
                'needs_review' => $reading->needs_review,
            ];
        }

        return [
            'key' => 'reading:'.$reading->id,
            'label' => $this->conjectureLabel($reading->conjecture),
            'text' => $this->conjectureDisplayText($reading->conjecture),
            'selected' => $reading->id === $selectedReadingId,
            'reading_id' => $reading->id,
            'transcription_id' => null,
            'start_offset' => null,
            'end_offset' => null,
            'conjecture_id' => $reading->conjecture_id,
            'conjecture_type' => $reading->conjecture->type->value,
            'supplements_conjecture_id' => $reading->conjecture->supplements_conjecture_id,
            'bibliography' => $reading->conjecture->bibliography,
            'note' => $reading->conjecture->note,
            'range_end_lemma_id' => $reading->range_end_lemma_id,
            'replaced_text' => $replacedText,
            'extent_characters' => $reading->conjecture->extent_characters,
            'needs_review' => $reading->needs_review,
        ];
    }

    /**
     * @param  SupportCollection<int, Lemma>  $byId
     */
    private function replacedSpanText(LemmaReading $reading, Lemma $anchor, ?Transcription $base, SupportCollection $byId): ?string
    {
        if ($reading->range_end_lemma_id === null || $base === null) {
            return null;
        }

        $endLemma = $byId->get($reading->range_end_lemma_id);
        $startReading = $this->baseReadingOf($anchor, $base);
        $endReading = $endLemma !== null ? $this->baseReadingOf($endLemma, $base) : null;

        if ($startReading === null || $endReading === null) {
            return null;
        }

        return mb_substr($base->text, $startReading->start_offset, $endReading->end_offset - $startReading->start_offset);
    }

    /**
     * A plain (non-range) witness reading sitting beside a wider sibling
     * candidate shows only its own first word by default — nothing on it
     * indicates the manuscript's own wording continues, unchanged, through
     * the rest of the disputed span. This synthesizes that wider view so
     * an editor compares full competing readings ("swift red fox" vs
     * "creature") instead of a misleadingly partial one ("swift" vs
     * "creature") — and returns a real end_offset/range_end_lemma_id so
     * picking it (see EditionVariantController::store) creates the
     * matching wider reading on the spot, exactly as if PassageAligner
     * itself had detected the divergence at materialization time.
     *
     * Returns null when there's nothing to extend to, when this reading is
     * already its own genuine range, when it's not witness-sourced, when a
     * real reading already covers this exact witness+range combination, or
     * when this particular witness doesn't reach as far as the widest
     * sibling — a fragmentary or already-divergent witness ("variants
     * within the manuscript readings") is left exactly as it is, never
     * stretched to fit.
     *
     * @return array{text: string, end_offset: int, range_end_lemma_id: int}|null
     */
    private function witnessExtension(LemmaReading $reading, Lemma $anchor, ?Lemma $referenceEnd): ?array
    {
        if ($reading->transcription_id === null || $reading->range_end_lemma_id !== null || $referenceEnd === null) {
            return null;
        }

        $alreadyExtended = $anchor->readings->contains(
            fn (LemmaReading $sibling) => $sibling->transcription_id === $reading->transcription_id
                && $sibling->range_end_lemma_id === $referenceEnd->id
        );

        if ($alreadyExtended) {
            return null;
        }

        $endReading = $referenceEnd->readings->first(fn (LemmaReading $r) => $r->transcription_id === $reading->transcription_id);

        if ($endReading === null) {
            return null;
        }

        return [
            'text' => mb_substr($reading->transcription->text, $reading->start_offset, $endReading->end_offset - $reading->start_offset),
            'end_offset' => $endReading->end_offset,
            'range_end_lemma_id' => $referenceEnd->id,
        ];
    }

    /**
     * A lacuna/supplement is still, at heart, a conjecture — credited the
     * same way as a substitution — but reads differently in the apparatus.
     * A transposition/reordering never reaches here (neither ever gets a
     * LemmaReading — see EditionTransposition/EditionPassageOrder); both
     * cases only exist for match exhaustiveness.
     */
    private function conjectureLabel(Conjecture $conjecture): string
    {
        $proposer = $conjecture->proposed_by ?? $conjecture->user->name;

        return match ($conjecture->type) {
            ConjectureType::Lacuna => 'lacuna — '.$proposer,
            ConjectureType::Supplement => 'suppl. — '.$proposer,
            ConjectureType::Substitution => 'conj. '.$proposer,
            ConjectureType::Transposition => 'transp. — '.$proposer,
            ConjectureType::Reordering => 'reorder. — '.$proposer,
        };
    }

    /**
     * A lacuna's `text` is nullable — a bare lacuna (nothing proposed to
     * fill it) still needs *something* to display in the continuous text.
     * A substitution/supplement always has text; a transposition never
     * reaches here.
     */
    private function conjectureDisplayText(Conjecture $conjecture): string
    {
        if ($conjecture->text !== null) {
            return $conjecture->text;
        }

        return $conjecture->extent !== null ? "[lacuna: {$conjecture->extent}]" : '[lacuna]';
    }
}
