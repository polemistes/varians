<?php

namespace App\Http\Controllers;

use App\Enums\ConjectureType;
use App\Enums\Layer;
use App\Enums\Tokenization;
use App\Http\Requests\StoreEditionRequest;
use App\Http\Requests\UpdateEditionRequest;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionComment;
use App\Models\EditionLemma;
use App\Models\EditionLineBreak;
use App\Models\EditionPassage;
use App\Models\EditionTransposition;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\Work;
use App\Support\Edition\DiplomaticCounterpart;
use App\Support\Edition\PermutationBlocks;
use App\Support\Transcription\GreekText;
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
            ->with(['canonicalPassage:id,label,sort_key,address', 'transcriptionLayer.transcription.witness:id,siglum'])
            ->get();

        // The stored positions ARE the printed order — nothing is reordered
        // at render time. Rearranging happens by rewriting positions
        // (PassageOrderRewriter): direct cut-and-paste, or applying a
        // transposition/reordering proposal or a witness's order. Adopted
        // proposals (EditionTransposition) are pure attribution records.
        $orderedPassages = $editionPassages->values();

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
        $transcriptions = TranscriptionLayer::forWork($work)->visibleTo($request->user())->collatable()
            ->with([
                'transcription.witness:id,siglum',
                'segments' => fn ($query) => $query->whereHas('canonicalPassage', fn ($q) => $q->where('work_id', $work->id)),
                'segments.canonicalPassage:id,work_id,address,sort_key,label',
            ])
            ->get(['id', 'transcription_id', 'text', 'layer']);

        $orderRanges = $this->orderRanges($window, $transcriptions);
        $discontinuities = $this->citationDiscontinuities($transcriptions);

        // The diplomatic counterpart of each normalized layer above, keyed by
        // the transcription both belong to, so a reader can see through the
        // regularized text to what the manuscript has — see
        // DiplomaticCounterpart.
        //
        // Keyed by transcription rather than by witness because a witness may
        // be transcribed more than once: keying by witness would let one
        // transcription's diplomatic layer silently answer for another's, and
        // the two are different texts. The counterpart of a normalized layer
        // is its own sibling, never merely some layer of the same manuscript.
        //
        // Visibility-filtered like everything else: a draft diplomatic layer
        // stays invisible even where its normalized counterpart is published.
        $diplomaticLayers = TranscriptionLayer::where('layer', Layer::Diplomatic)
            ->visibleTo($request->user())
            ->whereIn('transcription_id', $transcriptions->pluck('transcription_id')->unique())
            ->with([
                'transcription.witness:id,siglum',
                'segments' => fn ($query) => $query->whereHas('canonicalPassage', fn ($q) => $q->where('work_id', $work->id)),
                'segments.canonicalPassage:id,label',
            ])
            ->get(['id', 'transcription_id', 'text', 'layer'])
            ->keyBy('transcription_id');

        return Inertia::render('Editions/Show', [
            'work' => $work->only(['id', 'title', 'slug']),
            'edition' => $edition,
            'page' => $page,
            'totalPages' => $totalPages,
            'passages' => $this->annotatePassageStatus($orderedPassages, $edition),
            'windowPassages' => $window->values()
                ->map(fn (EditionPassage $editionPassage, int $index) => $this->passageDetail($editionPassage, $edition, $orderRanges[$index] ?? null, $diplomaticLayers, $work->tokenization, $discontinuities[$editionPassage->canonical_passage_id] ?? []))
                ->values(),
            // The work's *entire* citation space, regardless of what's in
            // this edition yet — the bulk "base a range" picker searches a
            // citation range for segments to add, so it must be able to
            // name a range that isn't in the edition at all yet (unlike
            // `passages` above, which the transposition picker uses and is
            // deliberately scoped to what's already been added).
            'workPassages' => $work->canonicalPassages()->orderBy('sort_key')->get(['id', 'address']),
            // Applied order proposals — attribution records, since the order
            // itself lives in the stored positions. A row's conjecture may be
            // a Transposition (range moved before/after a target) or a
            // Reordering (a resequenced range), so the target fields are
            // nullable.
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
                    'type' => $adoption->conjecture->type->value,
                    'from_label' => $adoption->conjecture->canonicalPassage->label,
                    'to_label' => $adoption->conjecture->transpositionRangeEnd->label ?? null,
                    'target_label' => $adoption->conjecture->moveTarget?->label,
                    'move_position' => $adoption->conjecture->move_position,
                    'proposed_by' => $adoption->conjecture->proposed_by ?? $adoption->conjecture->user->name,
                ])->values(),
            // Each transcription's own text/segments, for the "Add text"
            // panel's tabbed selection view — scoped to segments citing
            // *this* work, since a transcription can carry citations into
            // more than one work.
            'transcriptions' => $transcriptions,
            // Every layer of every witness, trimmed to the passages on
            // screen, for the right-hand witness pane. Both layers, unlike
            // `transcriptions` above: that one feeds collation and the add
            // panel, which only a normalized transcript may source, whereas
            // reading a manuscript is exactly when the diplomatic layer is
            // wanted.
            'witnessTranscripts' => $this->witnessTranscripts(
                $transcriptions,
                $diplomaticLayers,
                $window->pluck('canonical_passage_id')->all(),
            ),
            'referenceLevels' => $work->referenceScheme->levels,
        ]);
    }

    /**
     * Each visible transcript of the work, in both layers, cut down to the
     * stretch covering the passages currently displayed.
     *
     * Ordered by siglum then layer, matching how the apparatus orders
     * witnesses, so the pane's buttons don't move between page loads.
     *
     * @param  SupportCollection<int, TranscriptionLayer>  $normalized
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomatic  Keyed by witness id.
     * @param  array<int, int>  $windowPassageIds
     * @return array<int, array{id: int, witness_id: int, siglum: string, layer: string, text: string, segments: array<int, array<string, mixed>>, covers_window: bool}>
     */
    private function witnessTranscripts(SupportCollection $normalized, SupportCollection $diplomatic, array $windowPassageIds): array
    {
        return $normalized->values()
            ->merge($diplomatic->values())
            ->map(fn (TranscriptionLayer $transcription) => [
                'id' => $transcription->id,
                'witness_id' => $transcription->transcription->witness_id,
                'siglum' => $transcription->transcription->witness->siglum,
                'layer' => $transcription->layer->value,
                ...$this->windowSlice($transcription, $windowPassageIds),
            ])
            ->sortBy(fn (array $entry) => [$entry['siglum'], $entry['layer']])
            ->values()
            ->all();
    }

    /**
     * The span of a transcript's text that its cited segments occupy within
     * the displayed passages, with segment offsets rebased onto that slice.
     *
     * Sending the whole manuscript would make the payload grow with the
     * transcript rather than with the window, and the pane only ever shows
     * what stands beside the edition on screen. The slice runs from the first
     * covering segment to the last, so any text between two cited passages
     * comes along — that is the witness's own continuous text, which is what
     * the pane is for, not a per-passage extract.
     *
     * @param  array<int, int>  $windowPassageIds
     * @return array{text: string, segments: array<int, array<string, mixed>>, covers_window: bool}
     */
    private function windowSlice(TranscriptionLayer $transcription, array $windowPassageIds): array
    {
        $covering = $transcription->segments
            ->filter(fn (TranscriptionSegment $segment) => in_array($segment->canonical_passage_id, $windowPassageIds, true));

        if ($covering->isEmpty()) {
            return ['text' => '', 'segments' => [], 'covers_window' => false];
        }

        // One contiguous slice over everything the window's passages cover.
        // A passage cited in several places (a transposed part far from its
        // siblings) widens this across the gap, showing intervening text —
        // accepted: the pane stays one readable stretch, and the filter
        // below keeps rendering correct either way.
        $start = (int) $covering->min('start_offset');
        $end = (int) $covering->max('end_offset');

        // Only segments lying wholly inside the slice: AlignableText discards
        // any whose end runs past the text it was given, so a half-included
        // segment would silently vanish rather than render clipped.
        $segments = $transcription->segments
            ->filter(fn (TranscriptionSegment $segment) => $segment->start_offset >= $start && $segment->end_offset <= $end)
            ->map(fn (TranscriptionSegment $segment) => [
                'id' => $segment->id,
                'canonical_passage_id' => $segment->canonical_passage_id,
                'start_offset' => $segment->start_offset - $start,
                'end_offset' => $segment->end_offset - $start,
                'canonical_passage' => [
                    'id' => $segment->canonical_passage_id,
                    'label' => $segment->canonicalPassage?->label,
                ],
            ])
            ->values()
            ->all();

        return [
            'text' => mb_substr($transcription->text, $start, $end - $start),
            'segments' => $segments,
            'covers_window' => true,
        ];
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
     * Notices what no one asked it to: for the edition's stored order,
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
     * This is a calm, always-derived report, like the ⇄ discontinuity
     * marker: it states that other sources order these passages differently
     * and offers each ordering as an applyable candidate. There is no
     * "settled" state to store or re-flag — the stored positions are the
     * decision, and a range where nothing disagrees simply shows nothing.
     *
     * @param  SupportCollection<int, EditionPassage>  $window
     * @param  SupportCollection<int, TranscriptionLayer>  $transcriptions  Each with `segments` (and `segments.canonicalPassage`) and `witness` already eager-loaded — see show().
     * @return array<int, array{range_key: string, range_start_canonical_passage_id: int, range_end_canonical_passage_id: int, candidates: array<int, array<string, mixed>>}>
     */
    private function orderRanges(SupportCollection $window, SupportCollection $transcriptions): array
    {
        $ordered = $window->values();
        $indexBlocks = [];

        foreach ($transcriptions as $transcription) {
            // A passage's physical position is its *earliest* citation span.
            // Deliberate for a passage cited in several places: a transposed
            // part is a sub-passage matter, reported per passage via
            // citationDiscontinuities(), and must not drag the whole passage
            // into a whole-passage reorder range here.
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

        $ranges = [];

        foreach ($this->mergeIndexBlocks($indexBlocks) as [$startIndex, $endIndex]) {
            $rangeInfo = $this->buildOrderRangeInfo($ordered, $startIndex, $endIndex, $transcriptions);

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
     * @param  SupportCollection<int, TranscriptionLayer>  $transcriptions
     * @return array{range_key: string, range_start_canonical_passage_id: int, range_end_canonical_passage_id: int, candidates: array<int, array<string, mixed>>}|null
     */
    private function buildOrderRangeInfo(SupportCollection $ordered, int $startIndex, int $endIndex, SupportCollection $transcriptions): ?array
    {
        $rangePassages = $ordered->slice($startIndex, $endIndex - $startIndex + 1)->values();
        $canonicalPassageIds = $rangePassages->pluck('canonical_passage_id')->all();
        $labelByPassageId = $rangePassages->keyBy('canonical_passage_id');

        $startPassageId = $ordered[$startIndex]->canonical_passage_id;
        $endPassageId = $ordered[$endIndex]->canonical_passage_id;

        $candidates = [];

        // Citation order is always a candidate — the vulgate numbering an
        // apparatus reports transpositions against.
        $citationSequence = $rangePassages
            ->sortBy(fn (EditionPassage $editionPassage) => $editionPassage->canonicalPassage->sort_key)
            ->pluck('canonical_passage_id')
            ->all();

        $candidates[] = [
            'source' => 'citation',
            'transcription_layer_id' => null,
            'conjecture_id' => null,
            'proposed_by' => null,
            'sequence' => collect($citationSequence)->map(fn (int $id) => $labelByPassageId->get($id)?->canonicalPassage->label)->all(),
            'witness_siglum' => null,
            'matches_current' => $citationSequence === $canonicalPassageIds,
        ];

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
                'transcription_layer_id' => $transcription->id,
                'conjecture_id' => null,
                'proposed_by' => null,
                'sequence' => collect($sequence)->map(fn (int $id) => $labelByPassageId->get($id)?->canonicalPassage->label)->all(),
                'witness_siglum' => $transcription->transcription->witness->siglum,
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
                'transcription_layer_id' => null,
                'conjecture_id' => $conjecture->id,
                'proposed_by' => $conjecture->proposed_by ?? $conjecture->user->name,
                'sequence' => collect($sequenceIds)->map(fn (int $id) => $labelByPassageId->get($id)?->canonicalPassage->label)->all(),
                'witness_siglum' => null,
                'matches_current' => $sequenceIds === $canonicalPassageIds,
            ];
        }

        $hasAlternative = collect($candidates)->contains(fn (array $candidate) => ! $candidate['matches_current']);

        if (! $hasAlternative) {
            return null;
        }

        return [
            'range_key' => "{$startPassageId}-{$endPassageId}",
            'range_start_canonical_passage_id' => $startPassageId,
            'range_end_canonical_passage_id' => $endPassageId,
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
     * Passages whose text a witness holds in more than one place, keyed by
     * canonical passage id — the sub-passage counterpart of orderRanges'
     * whole-passage divergence detection, and like it derived from citation
     * spans at display time rather than stored.
     *
     * Each part carries the label of the nearest preceding span citing a
     * *different* passage (skipping sibling parts, which merely sit next to
     * each other), so the page can say "part 2 follows 42"; null means the
     * part stands before anything else the layer cites.
     *
     * @param  SupportCollection<int, TranscriptionLayer>  $transcriptions
     * @return array<int, array<int, array{siglum: string, parts: array<int, array{part: int, after_label: string|null}>}>>
     */
    private function citationDiscontinuities(SupportCollection $transcriptions): array
    {
        $result = [];

        foreach ($transcriptions as $layer) {
            $byOffset = $layer->segments->sortBy('start_offset')->values();

            foreach ($layer->segments->groupBy('canonical_passage_id') as $passageId => $parts) {
                if ($parts->count() < 2) {
                    continue;
                }

                $result[$passageId][] = [
                    'siglum' => $layer->transcription->witness->siglum,
                    'parts' => TranscriptionSegment::sortByPartOrder($parts)
                        ->map(function (TranscriptionSegment $segment) use ($byOffset, $passageId) {
                            $preceding = $byOffset
                                ->filter(fn (TranscriptionSegment $other) => $other->start_offset < $segment->start_offset
                                    && $other->canonical_passage_id !== $passageId)
                                ->last();

                            return [
                                'part' => $segment->part,
                                'after_label' => $preceding?->canonicalPassage->label,
                            ];
                        })
                        ->values()
                        ->all(),
                ];
            }
        }

        return array_map(
            fn (array $witnesses) => collect($witnesses)->sortBy('siglum')->values()->all(),
            $result,
        );
    }

    /**
     * @param  array{range_key: string, range_start_canonical_passage_id: int, range_end_canonical_passage_id: int, candidates: array<int, array<string, mixed>>}|null  $orderRange
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomaticLayers  each witness's diplomatic layer, keyed by witness id
     * @param  array<int, array{siglum: string, parts: array<int, array{part: int, after_label: string|null}>}>  $discontinuousWitnesses
     * @return array<string, mixed>
     */
    private function passageDetail(EditionPassage $editionPassage, Edition $edition, ?array $orderRange, SupportCollection $diplomaticLayers, Tokenization $tokenization, array $discontinuousWitnesses = []): array
    {
        $passage = $editionPassage->canonicalPassage;
        $base = $editionPassage->transcriptionLayer;

        return [
            'id' => $passage->id,
            'edition_passage_id' => $editionPassage->id,
            'label' => $passage->label,
            'order_range' => $orderRange,
            // This edition's own lineation for the passage boundary — seeded
            // once from the base transcription at add time, edition-owned
            // ever after. Within-passage breaks ride on the runs instead.
            'starts_new_line' => $editionPassage->starts_new_line,
            'starts_new_paragraph' => $editionPassage->starts_new_paragraph,
            // Witnesses whose text for this passage is physically
            // discontinuous — a transposition split it across two or more
            // places. Derived from the citation spans, never stored, so it
            // can't drift out of sync with the transcription.
            'discontinuous_witnesses' => $discontinuousWitnesses,
            'base' => $base !== null ? [
                'transcription_layer_id' => $base->id,
                'witness_siglum' => $base->transcription->witness->siglum,
            ] : null,
            'runs' => $this->materializedRuns($passage, $base, $edition, $diplomaticLayers, $tokenization),
            // The chosen witness's own line as the manuscript has it.
            'base_diplomatic' => $base !== null
                ? DiplomaticCounterpart::forPassage($passage, $diplomaticLayers->get($base->transcription_id))
                : null,
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
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomaticLayers  each witness's diplomatic layer, keyed by witness id
     * @return array<int, array<string, mixed>>
     */
    private function materializedRuns(CanonicalPassage $passage, ?TranscriptionLayer $base, Edition $edition, SupportCollection $diplomaticLayers, Tokenization $tokenization): array
    {
        $lemmas = Lemma::where('canonical_passage_id', $passage->id)
            ->orderBy('position')
            ->with([
                'readings.transcriptionLayer:id,transcription_id,text',
                'readings.transcriptionLayer.transcription.witness:id,siglum',
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
                $runs[] = $this->materializedRangeRun($lemma, $rangeEndLemma, $selection, $base, $byId, $passage, $diplomaticLayers, $tokenization);
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

            $runs[] = $this->materializedSingleRun($lemma, $selection, $base, $lastBaseEnd, $byId, $passage, $diplomaticLayers, $tokenization, $baseRangeEnd);
            $lastBaseEnd = $baseReading->end_offset ?? $lastBaseEnd;

            $coveredUntil = $baseRangeEnd !== null
                ? $lemmas->search(fn (Lemma $candidate) => $candidate->id === $baseRangeEnd->id)
                : false;

            $index = $coveredUntil !== false ? $coveredUntil + 1 : $index + 1;
        }

        return $this->withBreaks($runs, $lemmas, $edition, $passage);
    }

    /**
     * Resolve this edition's within-passage line breaks (EditionLineBreak —
     * its colometry) against the run walk, not the raw column list: runs
     * skip columns a range selection or the base's wider reading covers, so
     * a break anchored to a swallowed column has no run of its own and folds
     * onto the run covering it (rendering before that run — the closest
     * expressible position).
     *
     * @param  array<int, array<string, mixed>>  $runs
     * @param  SupportCollection<int, Lemma>  $lemmas
     * @return array<int, array<string, mixed>>
     */
    private function withBreaks(array $runs, SupportCollection $lemmas, Edition $edition, CanonicalPassage $passage): array
    {
        $breaks = EditionLineBreak::where('edition_id', $edition->id)
            ->where('canonical_passage_id', $passage->id)
            ->get()
            ->keyBy('lemma_id');
        $indexOf = $lemmas->pluck('id')->flip();

        foreach ($runs as $i => $run) {
            $startIndex = $indexOf[$run['lemma_id']] ?? null;
            $endIndex = $run['range_end_lemma_id'] !== null
                ? ($indexOf[$run['range_end_lemma_id']] ?? $startIndex)
                : $startIndex;
            $kind = null;

            if ($startIndex !== null) {
                for ($j = $startIndex; $j <= $endIndex; $j++) {
                    $break = $breaks->get($lemmas[$j]->id);

                    if ($break !== null) {
                        $kind = $break->kind;

                        break;
                    }
                }
            }

            $runs[$i]['break_before'] = $kind;
        }

        return $runs;
    }

    /**
     * The base transcription's own reading on a lemma, if any — null
     * whenever `$base` itself is null (a whole-line lacuna has no base
     * transcription at all), never a bare `null === null` false match
     * against a conjecture reading's own null transcription_layer_id.
     */
    private function baseReadingOf(Lemma $lemma, ?TranscriptionLayer $base): ?LemmaReading
    {
        if ($base === null) {
            return null;
        }

        return $lemma->readings->first(fn (LemmaReading $reading) => $reading->transcription_layer_id === $base->id);
    }

    /**
     * @param  SupportCollection<int, Lemma>  $byId
     * @param  Lemma|null  $baseRangeEnd  last column the base's own reading here covers, when it spans more than this one
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomaticLayers  each witness's diplomatic layer, keyed by witness id
     * @return array<string, mixed>
     */
    private function materializedSingleRun(Lemma $lemma, ?EditionLemma $selection, ?TranscriptionLayer $base, ?int $lastBaseEnd, SupportCollection $byId, CanonicalPassage $passage, SupportCollection $diplomaticLayers, Tokenization $tokenization, ?Lemma $baseRangeEnd = null): array
    {
        $selectedReadingId = $selection->selected_reading_id ?? null;
        $baseReading = $this->baseReadingOf($lemma, $base);

        $candidates = $this->materializedCandidates($lemma, $selectedReadingId, $base, $byId, $passage, $diplomaticLayers, $tokenization);

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
                $baseReading !== null => mb_substr($baseReading->transcriptionLayer->text, $baseReading->start_offset, $baseReading->end_offset - $baseReading->start_offset),
                $isGap => '',
                default => $candidates->first()['text'] ?? '',
            };

        $baseStart = $baseReading->start_offset ?? $lastBaseEnd;
        $baseEnd = $baseReading->end_offset ?? $lastBaseEnd;

        // What the base manuscript itself shows for these words, so a reader
        // can see through the printed text token by token.
        $diplomatic = $baseReading !== null && $base !== null
            ? DiplomaticCounterpart::forSpan($passage, $base, $diplomaticLayers->get($base->transcription_id), $baseReading->start_offset, $baseReading->end_offset, $tokenization)
            : null;

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
            'diplomatic' => $diplomatic,
            'orthographic_variation' => $this->orthographicVariation($candidates, $base),
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
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomaticLayers  each witness's diplomatic layer, keyed by witness id
     * @return array<string, mixed>
     */
    private function materializedRangeRun(Lemma $startLemma, Lemma $endLemma, EditionLemma $selection, ?TranscriptionLayer $base, SupportCollection $byId, CanonicalPassage $passage, SupportCollection $diplomaticLayers, Tokenization $tokenization): array
    {
        $candidates = $this->materializedCandidates($startLemma, $selection->selected_reading_id, $base, $byId, $passage, $diplomaticLayers, $tokenization);
        $selectedCandidate = $candidates->first(fn (array $candidate) => $candidate['selected']);

        $startReading = $this->baseReadingOf($startLemma, $base);
        $endReading = $this->baseReadingOf($endLemma, $base);

        $diplomatic = $startReading !== null && $endReading !== null && $base !== null
            ? DiplomaticCounterpart::forSpan($passage, $base, $diplomaticLayers->get($base->transcription_id), $startReading->start_offset, $endReading->end_offset, $tokenization)
            : null;

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
            'diplomatic' => $diplomatic,
            'orthographic_variation' => $this->orthographicVariation($candidates, $base),
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
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomaticLayers  each witness's diplomatic layer, keyed by witness id
     * @return SupportCollection<int, array<string, mixed>>
     */
    private function materializedCandidates(Lemma $lemma, ?int $selectedReadingId, ?TranscriptionLayer $base, SupportCollection $byId, CanonicalPassage $passage, SupportCollection $diplomaticLayers, Tokenization $tokenization): SupportCollection
    {
        $referenceEnd = $this->widestRangeEnd($lemma, $byId);

        return $lemma->readings
            ->sortBy(fn (LemmaReading $reading): string => match (true) {
                $base !== null && $reading->transcription_layer_id === $base->id => '0',
                $reading->transcription_layer_id !== null => '1'.$reading->transcriptionLayer->transcription->witness->siglum,
                default => '2'.str_pad((string) $reading->id, 12, '0', STR_PAD_LEFT),
            })
            ->map(
                fn (LemmaReading $reading): array => $this->materializedCandidate($reading, $selectedReadingId, $lemma, $base, $byId, $referenceEnd, $passage, $diplomaticLayers, $tokenization)
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
     * Whether a reading says the same word as the base and merely spells it
     * differently — accent, breathing or pointing alone.
     *
     * Reported rather than suppressed: whether an orthographic difference is
     * worth printing is the editor's call, not the collator's, and she can
     * say so in a note (see EditionComment). Identical spellings are not
     * "orthographic variants" at all, so they are excluded.
     */
    private static function differsOnlyInOrthography(?string $baseText, string $text): bool
    {
        if ($baseText === null || $baseText === $text) {
            return false;
        }

        return GreekText::foldOrthography($baseText) === GreekText::foldOrthography($text);
    }

    /**
     * Whether every way the witnesses differ here is a matter of accents,
     * breathings or pointing.
     *
     * Collation reads the normalized layer, and that is exactly where such
     * marks are supplied: an editor accenting one witness and not another
     * produces a difference no scribe made. Without a diplomatic layer to
     * check against there is no way to tell such a difference from a real
     * one, so it is reported as the editorial choice it most likely is —
     * where a diplomatic layer *does* show the manuscripts differing, the
     * client says so instead.
     *
     * @param  SupportCollection<int, array<string, mixed>>  $candidates
     */
    private function orthographicVariation(SupportCollection $candidates, ?TranscriptionLayer $base): bool
    {
        if ($base === null) {
            return false;
        }

        $witnesses = $candidates->filter(fn (array $candidate) => $candidate['transcription_layer_id'] !== null);
        $baseText = $witnesses->firstWhere('transcription_layer_id', $base->id)['text'] ?? null;

        if ($baseText === null || $witnesses->pluck('text')->unique()->count() < 2) {
            return false;
        }

        return $witnesses->every(
            fn (array $candidate) => $candidate['text'] === $baseText || $candidate['orthographic_only'],
        );
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
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomaticLayers  each witness's diplomatic layer, keyed by witness id
     * @return array<string, mixed>
     */
    private function materializedCandidate(LemmaReading $reading, ?int $selectedReadingId, Lemma $anchor, ?TranscriptionLayer $base, SupportCollection $byId, ?Lemma $referenceEnd, CanonicalPassage $passage, SupportCollection $diplomaticLayers, Tokenization $tokenization): array
    {
        $replacedText = $this->replacedSpanText($reading, $anchor, $base, $byId);
        $extension = $this->witnessExtension($reading, $anchor, $referenceEnd);
        $baseReading = $this->baseReadingOf($anchor, $base);
        $baseText = $baseReading !== null
            ? mb_substr($baseReading->transcriptionLayer->text, $baseReading->start_offset, $baseReading->end_offset - $baseReading->start_offset)
            : null;

        if ($reading->transcription_layer_id !== null) {
            return [
                'key' => 'reading:'.$reading->id,
                'label' => $reading->transcriptionLayer->transcription->witness->siglum,
                'text' => $extension['text'] ?? mb_substr($reading->transcriptionLayer->text, $reading->start_offset, $reading->end_offset - $reading->start_offset),
                'selected' => $reading->id === $selectedReadingId,
                'reading_id' => $reading->id,
                'transcription_layer_id' => $reading->transcription_layer_id,
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
                // What this manuscript physically shows here, null where its
                // diplomatic layer is absent, unpublished, or divides the
                // line into a different number of words.
                // True where this reading differs from the base's only in
                // accent, breathing or pointing — an orthographic variant
                // rather than a different word. See GreekText::foldOrthography.
                'orthographic_only' => self::differsOnlyInOrthography(
                    $baseText,
                    $extension['text'] ?? mb_substr($reading->transcriptionLayer->text, $reading->start_offset, $reading->end_offset - $reading->start_offset),
                ),
                'diplomatic' => DiplomaticCounterpart::forSpan(
                    $passage,
                    $reading->transcriptionLayer,
                    $diplomaticLayers->get($reading->transcriptionLayer->transcription_id),
                    $reading->start_offset,
                    $extension['end_offset'] ?? $reading->end_offset,
                    $tokenization,
                ),
            ];
        }

        return [
            'key' => 'reading:'.$reading->id,
            'label' => $this->conjectureLabel($reading->conjecture),
            'text' => $this->conjectureDisplayText($reading->conjecture),
            'selected' => $reading->id === $selectedReadingId,
            'reading_id' => $reading->id,
            'transcription_layer_id' => null,
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
            'orthographic_only' => false,
            // A conjecture is nobody's manuscript reading, so there is no
            // diplomatic layer behind it.
            'diplomatic' => null,
        ];
    }

    /**
     * @param  SupportCollection<int, Lemma>  $byId
     */
    private function replacedSpanText(LemmaReading $reading, Lemma $anchor, ?TranscriptionLayer $base, SupportCollection $byId): ?string
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
        if ($reading->transcription_layer_id === null || $reading->range_end_lemma_id !== null || $referenceEnd === null) {
            return null;
        }

        $alreadyExtended = $anchor->readings->contains(
            fn (LemmaReading $sibling) => $sibling->transcription_layer_id === $reading->transcription_layer_id
                && $sibling->range_end_lemma_id === $referenceEnd->id
        );

        if ($alreadyExtended) {
            return null;
        }

        $endReading = $referenceEnd->readings->first(fn (LemmaReading $r) => $r->transcription_layer_id === $reading->transcription_layer_id);

        if ($endReading === null) {
            return null;
        }

        return [
            'text' => mb_substr($reading->transcriptionLayer->text, $reading->start_offset, $endReading->end_offset - $reading->start_offset),
            'end_offset' => $endReading->end_offset,
            'range_end_lemma_id' => $referenceEnd->id,
        ];
    }

    /**
     * A lacuna/supplement is still, at heart, a conjecture — credited the
     * same way as a substitution — but reads differently in the apparatus.
     * A transposition/reordering never reaches here (neither ever gets a
     * LemmaReading — they are order proposals applied to stored positions,
     * see EditionTransposition); both cases only exist for match
     * exhaustiveness.
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
