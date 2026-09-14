<?php

namespace App\Http\Controllers;

use App\Enums\ConjectureType;
use App\Enums\Layer;
use App\Enums\Tokenization;
use App\Enums\Visibility;
use App\Http\Requests\StoreEditionRequest;
use App\Http\Requests\UpdateEditionRequest;
use App\Models\Assignment;
use App\Models\BibliographyItem;
use App\Models\BibliographyReference;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionComment;
use App\Models\EditionLemma;
use App\Models\EditionLineBreak;
use App\Models\EditionParatext;
use App\Models\EditionSegment;
use App\Models\EditionTransposition;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\ManuscriptImage;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Models\User;
use App\Models\Work;
use App\Support\Bibliography\Biblatex;
use App\Support\Bibliography\EditionBibliography;
use App\Support\Bibliography\ReferenceFormatter;
use App\Support\Bibliography\Suggestions;
use App\Support\Edition\ConjectureCatalogue;
use App\Support\Edition\DiplomaticCounterpart;
use App\Support\Edition\EditionPublisher;
use App\Support\Edition\PermutationBlocks;
use App\Support\Edition\TranspositionProjection;
use App\Support\Transcription\GreekText;
use App\Support\Transcription\WordDivision;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection as SupportCollection;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

/**
 * @phpstan-type WindowContext array{comments: SupportCollection<array-key, SupportCollection<int, EditionComment>>, unplaced: SupportCollection<array-key, SupportCollection<int, Conjecture>>, lemmas: SupportCollection<array-key, SupportCollection<int, Lemma>>, selections: EloquentCollection<array-key, EditionLemma>, breaks: EloquentCollection<array-key, EditionLineBreak>, paratexts: SupportCollection<array-key, SupportCollection<int, EditionParatext>>, segment_references: SupportCollection<array-key, SupportCollection<int, BibliographyReference>>, parts: SupportCollection<array-key, SupportCollection<int, EditionSegment>>}
 * @phpstan-type Citation array{id: int, item_id: int, label: string, citation: string, prenote: string|null, postnote: string|null}
 */
class EditionController extends Controller
{
    /**
     * How many segments the continuous-text view renders per page
     * — segments are typically one verse line each, so this keeps a page's
     * alignment/rendering work small without needing reference-scheme-aware
     * windowing.
     */
    private const WINDOW = 50;

    /** Manuscript pages a witnesses-pane slice holds — see witnessPane(). */
    private const PANE_PAGES = 3;

    /**
     * What a candidate carries when nothing is said — left out of the wire,
     * and put back by `inflateCandidate` in resources/js/lib/apparatus.ts.
     * Most candidates are a witness's plain reading: every conjecture
     * field null, nothing selected, nothing to review — and named, those
     * fields outweighed the reading itself (real measurement: 191
     * candidates, 85 KB, on a ten-line page). Keep the two lists in step.
     *
     * @var array<string, mixed>
     */
    private const CANDIDATE_DEFAULTS = [
        'omitted' => false,
        'selected' => false,
        'transcription_layer_id' => null,
        'start_offset' => null,
        'end_offset' => null,
        'conjecture_id' => null,
        'conjecture_type' => null,
        'supplements_conjecture_id' => null,
        'references' => [],
        'note' => null,
        'range_end_lemma_id' => null,
        'replaced_text' => null,
        'extent_characters' => null,
        'needs_review' => false,
        'orthographic_only' => false,
    ];

    /**
     * Likewise for a run — see `inflateRun`.
     *
     * @var array<string, mixed>
     */
    private const RUN_DEFAULTS = [
        'range_end_lemma_id' => null,
        'extent_characters' => null,
        'decided' => false,
        'gap' => false,
        'omitted' => false,
        'break_before' => null,
        'orthographic_variation' => false,
    ];

    public function create(Work $work): Response
    {
        $this->authorize('create', [Edition::class, $work]);

        return Inertia::render('Editions/Create', ['work' => $work]);
    }

    public function store(StoreEditionRequest $request, Work $work): RedirectResponse
    {
        $edition = $work->editions()->create([
            'user_id' => $request->user()->id,
            'title' => $request->validated('title'),
            'description' => $request->validated('description'),
            'wraps_lines' => $request->boolean('wraps_lines', true),
        ]);

        return redirect()->route('editions.show', [$work, $edition]);
    }

    public function show(Request $request, Work $work, Edition $edition): Response
    {
        $this->authorize('view', $edition);
        abort_unless($work->is($edition->work), 404);

        $editionSegments = EditionSegment::where('edition_id', $edition->id)
            ->orderBy('position')
            ->with([
                'segment:id,label,sort_key,address',
                'transcriptionLayer.transcription.witness:id,siglum',
                // The base layer's own assignments, loaded once: the
                // diplomatic counterpart reads them for every word and
                // every candidate, and unloaded they cost a query each
                // (real incident: 1056 queries, 5.8 s, on one edition page).
                'transcriptionLayer.assignments' => fn ($query) => $query->whereHas('segment', fn ($q) => $q->where('work_id', $work->id)),
            ])
            ->get();

        // The stored positions ARE the printed order — nothing is reordered
        // at render time. Rearranging happens by rewriting positions
        // (SegmentOrderRewriter): direct cut-and-paste, or applying a
        // transposition/reordering proposal or a witness's order. Adopted
        // proposals (EditionTransposition) are pure attribution records.
        $orderedSegments = $editionSegments->values();

        $totalPages = max(1, (int) ceil($orderedSegments->count() / self::WINDOW));
        $page = max(1, min($totalPages, (int) $request->query('page', 1)));
        $offset = ($page - 1) * self::WINDOW;
        $window = $orderedSegments->slice($offset, self::WINDOW)->values();

        // Loaded once and shared by the "Add text" panel prop below and by
        // orderRanges() — every transcription's own assignments already carry
        // exactly the start_offset data a physical-order comparison needs,
        // so detection costs no extra query. Scoped to transcriptions this
        // viewer can actually see, same as the panel itself: a draft
        // transcription's own order must not leak to a non-editor via a
        // range marker either.
        //
        // Restricted to the collatable layer for both uses. The panel adds
        // text to an edition, which only a normalized transcription may
        // source. Ordering loses nothing by the same filter: a fork copies
        // the assignment assignments verbatim, so the normalized layer carries
        // the very same physical order its diplomatic parent does.
        $transcriptions = TranscriptionLayer::forWork($work)->visibleTo($request->user())->collatable()
            ->with([
                'transcription.witness:id,siglum,label',
                'assignments' => fn ($query) => $query->whereHas('segment', fn ($q) => $q->where('work_id', $work->id)),
                'assignments.segment:id,work_id,address,sort_key,label',
            ])
            ->get(['id', 'transcription_id', 'text', 'layer']);

        // Over the WHOLE edition, not the page: a witness that moves a line
        // across the page boundary is a disagreement the editor must still
        // be shown. Keyed by segment id.
        $orderRanges = $this->orderRanges($orderedSegments, $transcriptions);
        $discontinuities = $this->assignmentDiscontinuities(
            $transcriptions,
            $this->conjectureArrangements(array_values(array_map('intval', $window->pluck('segment_id')->all()))),
            $orderedSegments,
        );
        $context = $this->windowContext($window, $edition);

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
                'assignments' => fn ($query) => $query->whereHas('segment', fn ($q) => $q->where('work_id', $work->id)),
                'assignments.segment:id,label',
            ])
            ->get(['id', 'transcription_id', 'text', 'layer'])
            ->keyBy('transcription_id');

        return Inertia::render('Editions/Show', [
            'work' => $work->only(['id', 'title', 'slug']),
            'edition' => $edition,
            'can' => $this->abilities($request, $edition),
            'access' => $this->access($request, $edition),
            'page' => $page,
            'totalPages' => $totalPages,
            'segments' => $this->annotateSegmentStatus($orderedSegments->unique('segment_id')->values(), $edition),
            'windowSegments' => $window->values()
                ->map(fn (EditionSegment $editionSegment, int $index) => $this->segmentDetail(
                    $editionSegment,
                    $edition,
                    $orderRanges[$editionSegment->segment_id] ?? null,
                    $diplomaticLayers,
                    $work->tokenization,
                    $discontinuities[$editionSegment->segment_id] ?? [],
                    $context,
                    // The printed predecessor, which for the first segment
                    // of page 2+ sits on the previous page — the whole-line
                    // lacuna marker anchors there, not at the edition's start.
                    $offset + $index > 0 ? $orderedSegments->get($offset + $index - 1)?->id : null,
                ))
                ->values(),
            // The work's *entire* numbering space, regardless of what's in
            // this edition yet — the bulk "base a range" picker searches an
            // assignment range for assignments to add, so it must be able to
            // name a range that isn't in the edition at all yet (unlike
            // `segments` above, which is deliberately scoped to what's
            // already been added). Sort keys let the page widen a
            // registered rearrangement to assignment contiguity.
            'workSegments' => $work->segments()->orderBy('sort_key')->get(['id', 'address', 'label', 'sort_key']),
            // The work's conjectures as the Work page lists them, so a
            // conjecture named in a notice can be edited in place (editors)
            // or opened for its bibliography (readers).
            'workConjectures' => ConjectureCatalogue::forWork($work, $request->user()),
            // Which conjectures this edition follows — the page marks those
            // candidates as followed in the order panel.
            'transpositions' => EditionTransposition::where('edition_id', $edition->id)
                ->get(['id', 'conjecture_id'])
                ->map(fn (EditionTransposition $adoption) => [
                    'id' => $adoption->id,
                    'conjecture_id' => $adoption->conjecture_id,
                ])->values(),
            // Each transcription's own text/assignments, for the "Add text"
            // panel's selection view — scoped to assignments assigning *this*
            // work, since a transcription can carry assignments into more
            // than one work. Shaped explicitly so the panel can name each
            // transcript (witness siglum/label + the transcription's own
            // name) instead of falling back to a bare layer id.
            'transcriptions' => $transcriptions->map(fn (TranscriptionLayer $layer) => [
                'id' => $layer->id,
                'name' => $layer->transcription->name,
                'assignments' => $layer->assignments->map(fn (Assignment $assignment) => [
                    'id' => $assignment->id,
                    'segment_id' => $assignment->segment_id,
                ])->values(),
                'witness' => [
                    'id' => $layer->transcription->witness->id,
                    'siglum' => $layer->transcription->witness->siglum,
                    'label' => $layer->transcription->witness->label,
                ],
            ])->values(),
            // The witnesses pane — one witness, a run of its pages, both
            // layers — sent only when the pane asks for it, see witnessPane().
            'witnessPane' => Inertia::optional(fn () => $this->witnessPane($request, $transcriptions, $diplomaticLayers, $window, $request->user())),
            'referenceLevels' => $work->referenceScheme->levels,
            // Every visible witness assigning text to the work, not only those this
            // edition draws on — what is available, and what was left aside.
            'witnesses' => $this->witnessesAssigning($transcriptions, $editionSegments),
            // Every item this edition cites — from its segments and from
            // the conjectures placed on them — for the bibliography at the
            // foot of the page, and what the references picker needs to
            // create an item without leaving the page.
            'bibliography' => $this->bibliography($edition),
            'bibliographyForm' => [
                'registry' => Biblatex::registry(),
                'suggestions' => Suggestions::all(),
            ],
        ]);
    }

    /**
     * The witnesses behind the visible normalized layers assigning text to the work,
     * by siglum, each marked whether a segment of this edition is based on
     * one of its transcripts.
     *
     * @param  SupportCollection<int, TranscriptionLayer>  $transcriptions
     * @param  SupportCollection<int, EditionSegment>  $editionSegments
     * @return list<array{id: int, siglum: string, label: string|null, in_edition: bool}>
     */
    private function witnessesAssigning(SupportCollection $transcriptions, SupportCollection $editionSegments): array
    {
        $baseWitnessIds = $editionSegments
            ->map(fn (EditionSegment $editionSegment) => $editionSegment->transcriptionLayer?->transcription->witness_id)
            ->filter()
            ->unique()
            ->all();

        $witnesses = [];

        foreach ($transcriptions as $layer) {
            $witness = $layer->transcription->witness;
            $witnesses[$witness->id] = [
                'id' => $witness->id,
                'siglum' => $witness->siglum,
                'label' => $witness->label,
                'in_edition' => in_array($witness->id, $baseWitnessIds, true),
            ];
        }

        usort($witnesses, fn (array $a, array $b) => strnatcasecmp($a['siglum'], $b['siglum']));

        return $witnesses;
    }

    /**
     * The bibliography citations of one thing, as the apparatus prints them.
     *
     * @param  iterable<int, BibliographyReference>  $references
     * @return list<Citation>
     */
    private function citations(iterable $references): array
    {
        $citations = [];

        foreach ($references as $reference) {
            $citations[] = [
                'id' => $reference->id,
                'item_id' => $reference->bibliography_item_id,
                'label' => $reference->item->label,
                'citation' => $reference->citation(),
                'prenote' => $reference->prenote,
                'postnote' => $reference->postnote,
            ];
        }

        return $citations;
    }

    /**
     * The edition's bibliography: every item cited by one of its segments,
     * or by a conjecture placed (as a reading) on one of its segments —
     * the literature its apparatus draws on — in label order, formatted.
     *
     * @return list<array{id: int, label: string, reference: list<array{text: string, italic: bool}>}>
     */
    private function bibliography(Edition $edition): array
    {
        $entries = [];

        foreach (BibliographyItem::whereIn('id', EditionBibliography::itemIds($edition))->orderBy('label')->get() as $item) {
            $entries[] = [
                'id' => $item->id,
                'label' => $item->label,
                'reference' => ReferenceFormatter::runs($item),
            ];
        }

        return $entries;
    }

    /**
     * The witnesses pane, on demand — ONE witness, cut to a run of its
     * manuscript pages. An `Inertia::optional` prop: never in the page's
     * own response, sent only when the pane asks for it (`only:
     * ['witnessPane']`, with `witness` and `witness_page` in the query),
     * so a work with twenty witnesses of hundreds of pages costs the
     * edition page nothing until a manuscript is opened, and then only
     * the pages being read (user decision, 2026-09-14 — the whole-corpus
     * payload scaled with every transcript of the work).
     *
     * The witness is the one asked for, else the first by siglum. Both
     * layers of each of its transcripts come, each cut to PANE_PAGES
     * pages starting at the page asked for — or, when none is, at the
     * page where the witness has the first segment of the edition's
     * window, so the pane opens beside the text being read. A transcript
     * without page breaks comes whole.
     *
     * @param  SupportCollection<int, TranscriptionLayer>  $normalized
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomatic
     * @param  SupportCollection<int, EditionSegment>  $window
     * @return array{witness_id: int|null, page_id: int|null, transcribed_page_ids: list<int>, transcripts: list<array<string, mixed>>}
     */
    private function witnessPane(Request $request, SupportCollection $normalized, SupportCollection $diplomatic, SupportCollection $window, ?User $viewer): array
    {
        $bySiglum = $normalized->sortBy(fn (TranscriptionLayer $layer) => $layer->transcription->witness->siglum, SORT_NATURAL | SORT_FLAG_CASE);
        $witnessIds = $bySiglum->map(fn (TranscriptionLayer $layer) => (int) $layer->transcription->witness_id)->unique()->values();
        $requestedWitness = $request->integer('witness');
        $witnessId = $witnessIds->contains($requestedWitness) ? $requestedWitness : $witnessIds->first();

        if ($witnessId === null) {
            return ['witness_id' => null, 'page_id' => null, 'transcribed_page_ids' => [], 'transcripts' => []];
        }

        $ofWitness = fn (TranscriptionLayer $layer) => (int) $layer->transcription->witness_id === $witnessId;
        $normalizedOfWitness = $normalized->filter($ofWitness)->values();
        $layers = $normalizedOfWitness->merge($diplomatic->filter($ofWitness)->values());
        $normalizedIdByTranscription = $normalizedOfWitness->keyBy('transcription_id')->map(fn (TranscriptionLayer $layer) => $layer->id);

        // Pages and page breaks belong to the transcription and the witness;
        // photographs are filtered like everything else the viewer may see.
        foreach ($layers as $layer) {
            $layer->transcription->loadMissing(['pageBreaks.manuscriptPage', 'witness.pages']);
        }

        $imagesByPage = ManuscriptImage::visibleTo($viewer)
            ->where('witness_id', $witnessId)
            ->orderBy('position')
            ->get()
            ->groupBy('manuscript_page_id');

        $breaksByLayer = $layers->mapWithKeys(fn (TranscriptionLayer $layer) => [$layer->id => $this->pageBreaksOf($layer)]);

        $pageIds = $layers->flatMap(fn (TranscriptionLayer $layer) => array_column($breaksByLayer[$layer->id], 'manuscript_page_id'));
        $requestedPage = $request->integer('witness_page');
        $pageId = $pageIds->contains($requestedPage)
            ? $requestedPage
            : $this->pageOfWindow($normalizedOfWitness, $breaksByLayer, $window);

        $transcripts = $layers
            ->values()
            ->map(function (TranscriptionLayer $transcription) use ($normalizedIdByTranscription, $imagesByPage, $breaksByLayer, $pageId) {
                $slice = $this->sliceOf($transcription, $breaksByLayer[$transcription->id], $pageId);

                return [
                    'id' => $transcription->id,
                    'transcription_id' => $transcription->transcription_id,
                    'normalized_layer_id' => $normalizedIdByTranscription->get($transcription->transcription_id),
                    'name' => $transcription->transcription->name,
                    'witness_id' => $transcription->transcription->witness_id,
                    'siglum' => $transcription->transcription->witness->siglum,
                    'layer' => $transcription->layer->value,
                    'first_sort_key' => (string) ($transcription->assignments->min(fn (Assignment $assignment) => $assignment->segment?->sort_key) ?? ''),
                    ...$this->slicedTranscript($transcription, $slice, $breaksByLayer[$transcription->id]),
                    'pages' => $this->witnessPages($transcription, $imagesByPage),
                ];
            })
            ->sortBy(fn (array $entry) => [$entry['siglum'], $entry['first_sort_key'], $entry['layer']])
            ->values();

        return [
            'witness_id' => $witnessId,
            'page_id' => $pageId,
            'transcribed_page_ids' => array_values(array_unique(array_map('intval', $pageIds->all()))),
            'transcripts' => array_values($transcripts->all()),
        ];
    }

    /**
     * The page on which the witness has the first segment of the edition's
     * window — the first assignment, in window order, of one of its
     * normalized layers, and the last page break at or before it. Null
     * where the witness has none of the window, or no pages: the pane
     * then opens at the transcript's start.
     *
     * @param  SupportCollection<int, TranscriptionLayer>  $normalizedOfWitness
     * @param  SupportCollection<int, list<array{manuscript_page_id: int, start_line: int, start_offset: int, label: string}>>  $breaksByLayer
     * @param  SupportCollection<int, EditionSegment>  $window
     */
    private function pageOfWindow(SupportCollection $normalizedOfWitness, SupportCollection $breaksByLayer, SupportCollection $window): ?int
    {
        foreach ($window as $editionSegment) {
            foreach ($normalizedOfWitness as $layer) {
                $assignment = $layer->assignments
                    ->where('segment_id', $editionSegment->segment_id)
                    ->sortBy('start_offset')
                    ->first();

                if ($assignment === null) {
                    continue;
                }

                $pageId = null;

                foreach ($breaksByLayer[$layer->id] as $break) {
                    if ($break['start_offset'] > $assignment->start_offset) {
                        break;
                    }

                    $pageId = $break['manuscript_page_id'];
                }

                return $pageId;
            }
        }

        return null;
    }

    /**
     * Where the manuscript's pages begin in this layer's text, in text
     * order. A page break is held as a line (see TranscriptionPageBreak)
     * and resolved to this layer's own offset here.
     *
     * @return list<array{manuscript_page_id: int, start_line: int, start_offset: int, label: string}>
     */
    private function pageBreaksOf(TranscriptionLayer $transcription): array
    {
        $breaks = [];
        $sorted = $transcription->transcription->pageBreaks->sortBy('start_line');
        $offsets = $transcription->offsetsOfLines(array_values($sorted->map(fn ($break) => (int) $break->start_line)->all()));

        foreach ($sorted as $break) {
            $breaks[] = [
                'manuscript_page_id' => (int) $break->manuscript_page_id,
                'start_line' => (int) $break->start_line,
                'start_offset' => $offsets[(int) $break->start_line],
                'label' => (string) ($break->manuscriptPage->label ?? ''),
            ];
        }

        usort($breaks, fn (array $a, array $b) => $a['start_offset'] <=> $b['start_offset']);

        return $breaks;
    }

    /**
     * The stretch of a layer's text the pane shows: PANE_PAGES pages from
     * the one asked for (the first, when the page is not in this
     * transcript), the text before the first break counting with the
     * first page. A transcript without breaks is one page: the whole.
     *
     * `previous_page_id` and `next_page_id` name the pages a step back or
     * on would start at — a step is a whole slice, so consecutive slices
     * do not overlap.
     *
     * @param  list<array{manuscript_page_id: int, start_line: int, start_offset: int, label: string}>  $breaks
     * @return array{start: int, end: int, whole: bool, page_ids: list<int>, previous_page_id: int|null, next_page_id: int|null}
     */
    private function sliceOf(TranscriptionLayer $transcription, array $breaks, ?int $pageId): array
    {
        $length = mb_strlen($transcription->text);

        if ($breaks === []) {
            return ['start' => 0, 'end' => $length, 'whole' => true, 'page_ids' => [], 'previous_page_id' => null, 'next_page_id' => null];
        }

        $starts = array_column($breaks, 'start_offset');
        $starts[0] = 0;
        $ids = array_column($breaks, 'manuscript_page_id');
        $index = array_search($pageId, $ids, true);
        $index = $index === false ? 0 : $index;
        $after = min($index + self::PANE_PAGES, count($breaks));
        $end = $starts[$after] ?? $length;

        // A break stands at a line's start; the line break before it ends
        // the previous page's last line and would print as an empty one.
        if (isset($starts[$after]) && $end > 0 && mb_substr($transcription->text, $end - 1, 1) === "\n") {
            $end--;
        }

        return [
            'start' => $starts[$index],
            'end' => $end,
            'whole' => $index === 0 && $after >= count($breaks),
            'page_ids' => array_slice($ids, $index, $after - $index),
            'previous_page_id' => $index > 0 ? $ids[max(0, $index - self::PANE_PAGES)] : null,
            'next_page_id' => $ids[$after] ?? null,
        ];
    }

    /**
     * A layer's text, assignments, page breaks and image alignments within
     * the slice, offsets rebased to the slice's start and spans clipped to
     * its ends — the pane reads them against the text it was sent. Part
     * totals and ordinals are the whole layer's: a badge says "1 · 2/2"
     * even where the other part is on a page not sent.
     *
     * @param  array{start: int, end: int, whole: bool, page_ids: list<int>, previous_page_id: int|null, next_page_id: int|null}  $slice
     * @param  list<array{manuscript_page_id: int, start_line: int, start_offset: int, label: string}>  $breaks
     * @return array<string, mixed>
     */
    private function slicedTranscript(TranscriptionLayer $transcription, array $slice, array $breaks): array
    {
        $start = $slice['start'];
        $end = $slice['end'];
        $within = fn (int $spanStart, int $spanEnd) => $spanStart < $end && $spanEnd > $start;
        $rebase = fn (int $offset) => max(0, min($end, $offset) - $start);

        // Which part of its segment each span is, as a dense ordinal — raw
        // `part` values can carry gaps after merges and removals, and
        // AlignableText prints "label · ordinal/total" on a discontinuous
        // assignment's badges.
        $partOrdinals = [];

        foreach ($transcription->assignments->groupBy('segment_id') as $group) {
            foreach ($group->sortBy('part')->values() as $index => $assignment) {
                $partOrdinals[$assignment->id] = $index + 1;
            }
        }

        return [
            'text' => mb_substr($transcription->text, $start, $end - $start),
            'slice' => $slice,
            'assignments' => $transcription->assignments
                ->filter(fn (Assignment $assignment) => $within($assignment->start_offset, $assignment->end_offset))
                ->sortBy('start_offset')
                ->map(fn (Assignment $assignment) => [
                    'id' => $assignment->id,
                    'segment_id' => $assignment->segment_id,
                    'start_offset' => $rebase($assignment->start_offset),
                    'end_offset' => $rebase($assignment->end_offset),
                    'part' => $assignment->part,
                    'part_ordinal' => $partOrdinals[$assignment->id],
                    'segment' => [
                        'id' => $assignment->segment_id,
                        'label' => $assignment->segment?->label,
                    ],
                ])
                ->values()
                ->all(),
            'part_totals' => $transcription->assignments
                ->groupBy('segment_id')
                ->map(fn (SupportCollection $group) => $group->count())
                ->all(),
            'page_breaks' => array_values(array_map(
                fn (array $break) => [...$break, 'start_offset' => $rebase($break['start_offset'])],
                array_filter($breaks, fn (array $break) => $break['start_offset'] >= $start && $break['start_offset'] < $end),
            )),
            // The layer's image alignments on the pages sent, so the image
            // view can light up a region for the edition line under the
            // pointer and the line for the region under it (user decision).
            'regions' => $transcription->regions()
                ->where('start_offset', '<', $end)
                ->where('end_offset', '>', $start)
                ->orderBy('position')
                ->get(['id', 'transcription_layer_id', 'manuscript_image_id', 'group_id', 'text', 'start_offset', 'end_offset', 'position', 'x', 'y', 'width', 'height', 'needs_review'])
                ->map(function (TranscriptionRegion $region) use ($rebase) {
                    $region->start_offset = $rebase($region->start_offset);
                    $region->end_offset = $rebase($region->end_offset);

                    return $region;
                })
                ->values(),
        ];
    }

    /**
     * The witness's pages with their photograph — the pane's page
     * pulldowns, in both views.
     *
     * @param  SupportCollection<int, EloquentCollection<int, ManuscriptImage>>  $imagesByPage
     * @return list<array{id: int, label: string, position: float, image: array{id: int, witness_id: int, manuscript_page_id: int, url: string, position: string}|null}>
     */
    private function witnessPages(TranscriptionLayer $transcription, SupportCollection $imagesByPage): array
    {
        $pages = [];

        foreach ($transcription->transcription->witness->pages->sortBy('position') as $page) {
            /** @var ManuscriptImage|null $image */
            $image = $imagesByPage->get($page->id)?->first();
            $pages[] = [
                'id' => (int) $page->id,
                'label' => (string) $page->label,
                'position' => (float) $page->position,
                'image' => $image === null ? null : [
                    'id' => (int) $image->id,
                    'witness_id' => (int) $image->witness_id,
                    'manuscript_page_id' => (int) $image->manuscript_page_id,
                    'url' => $image->url,
                    'position' => (string) $image->position,
                ],
            ];
        }

        return $pages;
    }

    /**
     * A run as it travels: default-valued fields left out (RUN_DEFAULTS,
     * CANDIDATE_DEFAULTS), a candidate's key — always "reading:" and its
     * id — left for the client to make, and a diplomatic spelling that is
     * the text itself left unsaid. A null `diplomatic` stays: it means the
     * manuscript's own spelling is not known, which is not the same thing.
     *
     * @param  array<string, mixed>  $run
     * @return array<string, mixed>
     */
    private function slimRun(array $run): array
    {
        $run['candidates'] = array_map(function (array $candidate): array {
            unset($candidate['key']);

            return $this->withoutDefaults($this->withoutSameDiplomatic($candidate), self::CANDIDATE_DEFAULTS);
        }, $run['candidates']);

        return $this->withoutDefaults($this->withoutSameDiplomatic($run), self::RUN_DEFAULTS);
    }

    /**
     * @param  array<string, mixed>  $entry
     * @return array<string, mixed>
     */
    private function withoutSameDiplomatic(array $entry): array
    {
        if (($entry['diplomatic'] ?? null) !== null && $entry['diplomatic'] === $entry['text']) {
            unset($entry['diplomatic']);
        }

        return $entry;
    }

    /**
     * @param  array<string, mixed>  $entry
     * @param  array<string, mixed>  $defaults
     * @return array<string, mixed>
     */
    private function withoutDefaults(array $entry, array $defaults): array
    {
        foreach ($defaults as $field => $default) {
            if (array_key_exists($field, $entry) && $entry[$field] === $default) {
                unset($entry[$field]);
            }
        }

        return $entry;
    }

    /**
     * Title and description are editing; visibility is publishing, which
     * only the owner does — and which carries the work's witnesses and
     * conjectures along, see EditionPublisher.
     */
    /**
     * Who holds the edition and who may edit it — the owner for everyone,
     * the invited editors and the open offer for whoever may manage them.
     *
     * @return array{owner: array<string, mixed>|null, editors: array<int, array<string, mixed>>, offer: array<string, mixed>|null}
     */
    private function access(Request $request, Edition $edition): array
    {
        $user = $request->user();
        $manages = ($user?->can('manageEditors', $edition) ?? false) || ($user?->can('transfer', $edition) ?? false);
        $offer = $manages ? $edition->ownershipTransfers()->open()->with('toUser:id,name,email')->first() : null;

        return [
            'owner' => $edition->user()->first(['id', 'name'])?->only(['id', 'name']),
            'editors' => $manages
                ? $edition->editors()->orderBy('name')->get(['users.id', 'users.name', 'users.email'])
                    ->map(fn (User $editor) => $editor->only(['id', 'name', 'email']))->all()
                : [],
            'offer' => $offer === null ? null : [
                'id' => $offer->id,
                'to' => $offer->toUser->only(['id', 'name', 'email']),
            ],
        ];
    }

    /**
     * What the viewer may do to this edition, for the page to show or hide
     * its controls by — the policies decide, the client only reflects them.
     *
     * @return array{edit: bool, delete: bool, publish: bool, manage: bool, transfer: bool, copy: bool}
     */
    private function abilities(Request $request, Edition $edition): array
    {
        $user = $request->user();

        return [
            'edit' => $user?->can('update', $edition) ?? false,
            'delete' => $user?->can('delete', $edition) ?? false,
            'publish' => $user?->can('publish', $edition) ?? false,
            'manage' => $user?->can('manageEditors', $edition) ?? false,
            'transfer' => $user?->can('transfer', $edition) ?? false,
            'copy' => $user?->can('copy', $edition) ?? false,
        ];
    }

    public function update(UpdateEditionRequest $request, Edition $edition): RedirectResponse
    {
        $validated = $request->validated();

        if (array_key_exists('visibility', $validated)) {
            $this->authorize('publish', $edition);

            $visibility = Visibility::from($validated['visibility']);
            unset($validated['visibility']);

            if ($visibility !== $edition->visibility) {
                $visibility === Visibility::Published
                    ? EditionPublisher::publish($edition)
                    : EditionPublisher::unpublish($edition);
            }
        }

        $edition->update($validated);

        return back();
    }

    public function destroy(Edition $edition): RedirectResponse
    {
        $this->authorize('delete', $edition);

        $work = $edition->work;
        $edition->delete();

        return redirect()->route('works.show', $work);
    }

    /**
     * Notices what no one asked it to: where a source — a witness's own
     * physical order, or a catalogued Transposition/Reordering conjecture —
     * orders segments DIFFERENTLY FROM THE PRINTED ORDER. See
     * PermutationBlocks for the decomposition itself, which is a strict
     * generalization of a plain adjacent swap (the smallest possible
     * non-identity block is size 2). Blocks from different sources are
     * merged wherever they overlap, since only one candidate list makes
     * sense for one span of the text. A transcription that doesn't assign
     * every segment in the final merged block can't offer a whole-block
     * candidate (mirrors how a fragmentary witness already can't extend
     * past what it covers elsewhere, see witnessExtension()) — it simply
     * isn't listed as a candidate for that block.
     *
     * The printed order is the reference, and NUMBERING ORDER IS NOT A
     * SOURCE (user decision): that the printed order, or a manuscript's,
     * departs from numbering order is no news — the segment labels on the
     * lines already say so. What the editor needs surfacing is only where
     * what she PRINTS disagrees with a witness or with a catalogued
     * proposal. Numbering order remains available inside a block as an
     * applyable candidate, it just never creates one. (An earlier design
     * diffed sources against numbering order and flagged the editor's own
     * departure separately; both notices were noise by this measure.)
     *
     * A block's extent is the assignment span of the disagreeing stretch
     * (min..max sort_key of its members), so its members may be scattered
     * in the printed order. Each member's window index carries the same
     * block info; `anchor` is true only on the first member in printed
     * order, which is where the client renders the one marker.
     *
     * This is a calm, always-derived report, like the ⇄ discontinuity
     * marker: it states that sources order these segments differently from
     * the printed text and offers each ordering as an applyable candidate.
     * There is no "settled" state to store or re-flag — the stored
     * positions are the decision, and a block where nothing disagrees with
     * them simply shows nothing.
     *
     * @param  SupportCollection<int, EditionSegment>  $printed  the whole edition, in printed order
     * @param  SupportCollection<int, TranscriptionLayer>  $transcriptions  Each with `assignments` (and `assignments.segment`) and `witness` already eager-loaded — see show().
     * @return array<int, array<string, mixed>> keyed by segment id
     */
    private function orderRanges(SupportCollection $printed, SupportCollection $transcriptions): array
    {
        // A line printed in pieces stands where its first part stands.
        $ordered = $printed->unique('segment_id')->values();

        if ($ordered->count() < 2) {
            return [];
        }

        $byAssignment = $ordered
            ->sortBy(fn (EditionSegment $editionSegment) => $editionSegment->segment->sort_key)
            ->values();

        $assignmentIndexOf = [];

        foreach ($byAssignment as $index => $editionSegment) {
            $assignmentIndexOf[$editionSegment->segment_id] = $index;
        }

        $printedIndexOf = [];

        foreach ($ordered as $index => $editionSegment) {
            $printedIndexOf[$editionSegment->segment_id] = $index;
        }

        // One source's disagreement with the printed order, as assignment-
        // index blocks: the source's subset is laid out in printed order,
        // permuted into the source's own order, and each non-identity
        // block's members map to their assignment span.
        $blocksAgainstPrinted = function (array $subsetIds, array $sourceRankOf) use ($printedIndexOf, $assignmentIndexOf): array {
            $inPrintedOrder = collect($subsetIds)
                ->sortBy(fn (int $id) => $printedIndexOf[$id])
                ->values()
                ->all();

            $perm = [];

            foreach ($inPrintedOrder as $local => $id) {
                $perm[$local] = $sourceRankOf[$id];
            }

            $blocks = [];

            foreach (PermutationBlocks::nonIdentityBlocks($perm) as [$localStart, $localEnd]) {
                $memberAssignmentIndexes = array_map(
                    fn (int $id) => $assignmentIndexOf[$id],
                    array_slice($inPrintedOrder, $localStart, $localEnd - $localStart + 1),
                );

                if ($memberAssignmentIndexes === []) {
                    continue;
                }

                $blocks[] = [min($memberAssignmentIndexes), max($memberAssignmentIndexes)];
            }

            return $blocks;
        };

        $indexBlocks = [];

        foreach ($transcriptions as $transcription) {
            // A segment's physical position is its *earliest* assignment span.
            // Deliberate for a segment assigned in several places: a transposed
            // part is a sub-segment matter, reported per segment via
            // assignmentDiscontinuities(), and must not drag the whole segment
            // into a whole-segment reorder block here.
            $offsetsBySegmentId = $transcription->assignments
                ->groupBy('segment_id')
                ->map(fn (SupportCollection $assignments) => $assignments->min('start_offset'));

            $assignedIds = [];

            foreach ($ordered as $editionSegment) {
                if ($offsetsBySegmentId->has($editionSegment->segment_id)) {
                    $assignedIds[] = $editionSegment->segment_id;
                }
            }

            if (count($assignedIds) < 2) {
                continue;
            }

            $rankOf = [];

            foreach (collect($assignedIds)->sortBy(fn (int $id) => $offsetsBySegmentId->get($id))->values() as $rank => $id) {
                $rankOf[$id] = $rank;
            }

            array_push($indexBlocks, ...$blocksAgainstPrinted($assignedIds, $rankOf));
        }

        // Catalogued proposals are sources too: one creates a site the
        // moment the printed order stops (or never started) following it —
        // otherwise a proposal nobody has applied would be undiscoverable.
        // Both kinds come normalized to {ids, sequence} here: a
        // Reordering's stored entries, a Transposition's statement
        // projected onto its assignment span.
        $conjectureSources = $this->conjectureOrderSources($byAssignment, $assignmentIndexOf);

        foreach ($conjectureSources as $source) {
            array_push($indexBlocks, ...$blocksAgainstPrinted($source['ids'], array_flip($source['sequence'])));
        }

        $ranges = [];

        foreach ($this->mergeIndexBlocks($indexBlocks) as [$startIndex, $endIndex]) {
            $members = $byAssignment->slice($startIndex, $endIndex - $startIndex + 1)->values();
            $rangeInfo = $this->buildOrderRangeInfo($ordered, $members, $transcriptions, $conjectureSources);

            if ($rangeInfo === null) {
                continue;
            }

            $memberIds = $members->pluck('segment_id')->flip();
            $anchored = false;

            foreach ($ordered as $editionSegment) {
                if ($memberIds->has($editionSegment->segment_id)) {
                    $ranges[$editionSegment->segment_id] = $rangeInfo + ['anchor' => ! $anchored];
                    $anchored = true;
                }
            }
        }

        return $ranges;
    }

    /**
     * Every catalogued ordering proposal resolvable inside this window,
     * normalized to one shape so detection and candidate listing treat both
     * kinds alike:
     *
     * - a Reordering carries its sequence as stored entries;
     * - a Transposition is a statement, projected onto the assignment span
     *   its anchors bracket (see TranspositionProjection). Every record
     *   counts: since the edition page registers the editor's own
     *   rearrangement as a conjecture deliberately, there are no silent
     *   working marks left to keep out.
     *
     * A proposal reaching segments outside the window is skipped, like a
     * fragmentary witness.
     *
     * @param  SupportCollection<int, EditionSegment>  $byAssignment
     * @param  array<int, int>  $assignmentIndexOf
     * @return list<array{conjecture: Conjecture, ids: list<int>, sequence: list<int>}> ids in numbering order; sequence the proposed order of the same set
     */
    private function conjectureOrderSources(SupportCollection $byAssignment, array $assignmentIndexOf): array
    {
        $windowIds = $byAssignment->pluck('segment_id')->all();
        $sources = [];

        $reorderings = Conjecture::where('type', ConjectureType::Reordering)
            ->whereHas('orderingEntries', fn ($query) => $query->whereIn('segment_id', $windowIds))
            ->with(['orderingEntries', 'user:id,name'])
            ->get();

        foreach ($reorderings as $conjecture) {
            // A divided segment stands where its first part stands, the
            // way a witness's split assignment does in the order report.
            $entryIds = $conjecture->orderingEntries->pluck('segment_id')->unique()->values();

            if ($entryIds->count() < 2 || $entryIds->contains(fn (int $id) => ! array_key_exists($id, $assignmentIndexOf))) {
                continue;
            }

            $sources[] = [
                'conjecture' => $conjecture,
                'ids' => array_values($entryIds->sortBy(fn (int $id) => $assignmentIndexOf[$id])->all()),
                'sequence' => array_values($conjecture->orderingEntries->sortBy('sequence')->pluck('segment_id')->unique()->all()),
            ];
        }

        $transpositions = Conjecture::where('type', ConjectureType::Transposition)
            ->where(fn ($query) => $query
                ->whereIn('segment_id', $windowIds)
                ->orWhereIn('move_target_segment_id', $windowIds))
            ->with('user:id,name')
            ->get();

        foreach ($transpositions as $conjecture) {
            $anchors = [
                $conjecture->segment_id,
                $conjecture->transposition_range_end_segment_id ?? $conjecture->segment_id,
                $conjecture->move_target_segment_id,
            ];

            $anchorIndexes = [];

            foreach ($anchors as $anchor) {
                if ($anchor === null || ! array_key_exists($anchor, $assignmentIndexOf)) {
                    continue 2;
                }

                $anchorIndexes[] = $assignmentIndexOf[$anchor];
            }

            $memberIds = array_values($byAssignment
                ->slice(min($anchorIndexes), max($anchorIndexes) - min($anchorIndexes) + 1)
                ->pluck('segment_id')
                ->all());

            $sequence = TranspositionProjection::sequence($conjecture, $memberIds);

            if ($sequence === null || $sequence === $memberIds) {
                continue;
            }

            $sources[] = [
                'conjecture' => $conjecture,
                'ids' => $memberIds,
                'sequence' => $sequence,
            ];
        }

        return $sources;
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
     * One block's report. `$members` are the block's segments in assignment
     * order; `matches_current` compares each candidate against the members'
     * relative order as printed (they may be scattered among non-members in
     * the printed text — see orderRanges()). The block's endpoints are its
     * assignment-order first and last member, which is also how the apply
     * endpoint re-derives membership (EditionOrderController).
     *
     * @param  SupportCollection<int, EditionSegment>  $ordered  the window, in printed order
     * @param  SupportCollection<int, EditionSegment>  $members  the block, in numbering order
     * @param  SupportCollection<int, TranscriptionLayer>  $transcriptions
     * @param  list<array{conjecture: Conjecture, ids: list<int>, sequence: list<int>}>  $conjectureSources
     * @return array<string, mixed>|null
     */
    private function buildOrderRangeInfo(SupportCollection $ordered, SupportCollection $members, SupportCollection $transcriptions, array $conjectureSources): ?array
    {
        $memberIdSet = $members->pluck('segment_id')->flip();
        $labelBySegmentId = $members->keyBy('segment_id');

        $currentMembers = $ordered->filter(
            fn (EditionSegment $editionSegment) => $memberIdSet->has($editionSegment->segment_id),
        )->values();
        $currentIds = $currentMembers->pluck('segment_id')->all();

        $numberingSequence = $members->pluck('segment_id')->all();
        $memberCount = count($numberingSequence);

        $candidates = [];

        // The numbering order is always a candidate — the vulgate numbering an
        // apparatus reports transpositions against.
        $candidates[] = [
            'source' => 'numbering',
            'transcription_layer_id' => null,
            'conjecture_id' => null,
            'proposed_by' => null,
            'sequence' => collect($numberingSequence)->map(fn (int $id) => $labelBySegmentId->get($id)?->segment->label)->all(),
            'witness_siglum' => null,
            'matches_current' => $numberingSequence === $currentIds,
        ];

        foreach ($transcriptions as $transcription) {
            $assignedIds = $transcription->assignments->pluck('segment_id')->unique();

            if ($assignedIds->intersect($numberingSequence)->count() !== $memberCount) {
                continue; // fragmentary — doesn't assign every segment in the block
            }

            $sequence = $transcription->assignments
                ->whereIn('segment_id', $numberingSequence)
                ->groupBy('segment_id')
                ->map(fn (SupportCollection $assignments) => $assignments->min('start_offset'))
                ->sortBy(fn (int $offset) => $offset)
                ->keys()
                ->all();

            $candidates[] = [
                'source' => 'transcription',
                'transcription_layer_id' => $transcription->id,
                'conjecture_id' => null,
                'proposed_by' => null,
                'sequence' => collect($sequence)->map(fn (int $id) => $labelBySegmentId->get($id)?->segment->label)->all(),
                'witness_siglum' => $transcription->transcription->witness->siglum,
                'matches_current' => $sequence === $currentIds,
            ];
        }

        foreach ($conjectureSources as $source) {
            if ($source['ids'] !== $numberingSequence) {
                continue; // proposes an order for a different set than this block
            }

            $conjecture = $source['conjecture'];

            $candidates[] = [
                'source' => 'conjecture',
                'transcription_layer_id' => null,
                'conjecture_id' => $conjecture->id,
                'proposed_by' => $conjecture->proposed_by ?? $conjecture->user->name,
                'sequence' => collect($source['sequence'])->map(fn (int $id) => $labelBySegmentId->get($id)?->segment->label)->all(),
                'witness_siglum' => null,
                'matches_current' => $source['sequence'] === $currentIds,
            ];
        }

        // A block exists only where a WITNESS or a catalogued conjecture
        // disagrees with the printed order — the assignment candidate alone
        // never keeps one alive (that the printed order departs from
        // numbering order is no news; the line numbers say so). This bites
        // when the assignment-span expansion swallowed the only disagreeing
        // witness's candidacy (fragmentary rule): the block then has
        // nothing to say and is dropped.
        $hasAlternative = collect($candidates)->contains(
            fn (array $candidate) => $candidate['source'] !== 'numbering' && ! $candidate['matches_current'],
        );

        if (! $hasAlternative) {
            return null;
        }

        $startSegment = $members->first()->segment;
        $endSegment = $members->last()->segment;

        return [
            'range_key' => "{$startSegment->id}-{$endSegment->id}",
            'range_start_segment_id' => $startSegment->id,
            'range_end_segment_id' => $endSegment->id,
            // "6–7", for the one marker the block renders.
            'range_label' => $memberCount > 1 ? "{$startSegment->label}–{$endSegment->label}" : $startSegment->label,
            // Printed order of the members — the left column of the client's
            // slope graphs, and the reference `matches_current` is against.
            'member_segment_ids' => $currentIds,
            'current_sequence' => $currentMembers->map(fn (EditionSegment $editionSegment) => $editionSegment->segment->label)->all(),
            'candidates' => $candidates,
        ];
    }

    /**
     * Only `partial`/`complete` remain reachable now — a segment is only
     * ever in this list because it was added (materialized + base-selected
     * at add time, see SegmentAdder), so `no_base`/`untouched`/`needs_review`
     * can no longer occur.
     *
     * @param  SupportCollection<int, EditionSegment>  $segments
     * @return array<int, array<string, mixed>>
     */
    private function annotateSegmentStatus(SupportCollection $segments, Edition $edition): array
    {
        $segmentIds = $segments->pluck('segment_id');

        $lemmaCounts = DB::table('lemmas')
            ->whereIn('segment_id', $segmentIds)
            ->selectRaw('segment_id, COUNT(*) as total')
            ->groupBy('segment_id')
            ->get()
            ->keyBy('segment_id');

        // A single EditionLemma row can now claim more than one lemma
        // position (a range-shaped selection — see LemmaReading's
        // range_end_lemma_id), so "resolved" has to count every *lemma*
        // covered by a selection, not every selection row, or a segment
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
                $join->on('lemmas.segment_id', '=', 'start_lemma.segment_id')
                    ->where('lemmas.position', '>=', DB::raw('start_lemma.position'))
                    ->where('lemmas.position', '<=', DB::raw('COALESCE(end_lemma.position, start_lemma.position)'));
            })
            ->where('edition_lemmas.edition_id', $edition->id)
            ->whereIn('start_lemma.segment_id', $segmentIds)
            ->selectRaw('start_lemma.segment_id, COUNT(DISTINCT lemmas.id) as resolved')
            ->groupBy('start_lemma.segment_id')
            ->get()
            ->keyBy('segment_id');

        return $segments->values()->map(function (EditionSegment $editionSegment, int $index) use ($lemmaCounts, $selectedCounts): array {
            $segment = $editionSegment->segment;
            $total = (int) ($lemmaCounts->get($segment->id)->total ?? 0);
            $resolved = (int) ($selectedCounts->get($segment->id)->resolved ?? 0);

            return [
                'id' => $segment->id,
                'label' => $segment->label,
                'sort_key' => $segment->sort_key,
                'address' => $segment->address,
                'status' => $total === $resolved ? 'complete' : 'partial',
                'page' => intdiv($index, self::WINDOW) + 1,
            ];
        })->all();
    }

    /**
     * Segments whose text a witness holds in more than one place, keyed by
     * segment id — the sub-segment counterpart of orderRanges'
     * whole-segment divergence detection, and like it derived from assignment
     * spans at display time rather than stored.
     *
     * Each part carries the label of the nearest preceding span assigning a
     * *different* segment (skipping sibling parts, which merely sit next to
     * each other), so the page can say "part 2 follows 42"; null means the
     * part stands before anything else the layer assigns.
     *
     * @param  SupportCollection<int, TranscriptionLayer>  $transcriptions
     *                                                                      Each entry also says whether the edition's own printed arrangement of
     *                                                                      the source's pieces is the same (`matches_current`) — the source the
     *                                                                      line's ordering follows, rather than a variant of it.
     * @param  SupportCollection<int, array{name: string, text: string, assignments: SupportCollection<int, Assignment>, conjecture_id: int}>  $arrangements
     * @param  SupportCollection<int, EditionSegment>  $printed  the whole edition's rows, in printed order
     * @return array<int, array<int, array{siglum: string, conjecture_id: int|null, matches_current: bool, parts: array<int, array{part: int, after_label: string|null}>, statements: list<string>}>>
     */
    private function assignmentDiscontinuities(SupportCollection $transcriptions, SupportCollection $arrangements, SupportCollection $printed): array
    {
        $result = [];
        $printedKeys = array_values($printed
            ->map(fn (EditionSegment $row) => [(int) $row->segment_id, (int) $row->part])
            ->all());

        foreach ($transcriptions as $layer) {
            foreach ($this->discontinuitiesOf($layer->transcription->witness->siglum, $layer->text, $layer->assignments->toBase(), null, $printedKeys) as $segmentId => $entries) {
                $result[$segmentId] = [...($result[$segmentId] ?? []), ...$entries];
            }
        }

        // A conjecture that divides a line is the same kind of source as a
        // witness that assigns text to a line in two places, and is reported by the
        // same code (user decision).
        foreach ($arrangements as $arrangement) {
            foreach ($this->discontinuitiesOf($arrangement['name'], $arrangement['text'], $arrangement['assignments'], $arrangement['conjecture_id'], $printedKeys) as $segmentId => $entries) {
                $result[$segmentId] = [...($result[$segmentId] ?? []), ...$entries];
            }
        }

        return array_map(
            fn (array $witnesses) => collect($witnesses)->sortBy('siglum')->values()->all(),
            $result,
        );
    }

    /**
     * One source's split assignments, keyed by segment id.
     *
     * @param  SupportCollection<int, Assignment>  $assignments
     * @param  list<array{0: int, 1: int}>  $printedKeys  the edition's printed rows as (segment, part)
     * @return array<int, list<array{siglum: string, conjecture_id: int|null, matches_current: bool, parts: array<int, array{part: int, after_label: string|null}>, statements: list<string>}>>
     */
    private function discontinuitiesOf(string $siglum, string $text, SupportCollection $assignments, ?int $conjectureId, array $printedKeys): array
    {
        $result = [];
        $byOffset = $assignments->sortBy('start_offset')->values();
        $statements = $this->transpositionStatements($siglum, $text, $assignments);

        // The source's arrangement of the segments it assigns, as (segment,
        // part) in physical order, against the edition's printed rows of
        // the same segments: equal means the edition prints this
        // arrangement — it follows the source rather than varying from it.
        $sourceKeys = array_values($byOffset
            ->map(fn (Assignment $assignment) => [(int) $assignment->segment_id, (int) $assignment->part])
            ->all());
        $assigned = array_flip(array_map(fn (array $key) => $key[0], $sourceKeys));
        $printedIds = array_flip(array_map(fn (array $key) => $key[0], $printedKeys));
        $matchesCurrent = array_values(array_filter($printedKeys, fn (array $key) => isset($assigned[$key[0]])))
            === array_values(array_filter($sourceKeys, fn (array $key) => isset($printedIds[$key[0]])));

        foreach ($assignments->groupBy('segment_id') as $segmentId => $parts) {
            if ($parts->count() < 2) {
                continue;
            }

            $result[(int) $segmentId][] = [
                'siglum' => $siglum,
                'conjecture_id' => $conjectureId,
                'matches_current' => $matchesCurrent,
                'parts' => Assignment::sortByPartOrder($parts)
                    ->map(function (Assignment $assignment) use ($byOffset, $segmentId) {
                        $preceding = $byOffset
                            ->filter(fn (Assignment $other) => $other->start_offset < $assignment->start_offset
                                && $other->segment_id !== $segmentId)
                            ->last();

                        return [
                            'part' => $assignment->part,
                            'after_label' => $preceding?->segment->label,
                        ];
                    })
                    ->values()
                    ->all(),
                'statements' => $statements[$segmentId] ?? [],
            ];
        }

        return $result;
    }

    /**
     * Reordering conjectures that divide a segment shown in the window,
     * each shaped like a transcript — the pieces laid end to end as text,
     * assigned by unsaved Assignment stand-ins — so the split
     * assignment report reads them like a witness.
     *
     * @param  list<int>  $windowSegmentIds
     * @return SupportCollection<int, array{name: string, text: string, assignments: SupportCollection<int, Assignment>, conjecture_id: int}>
     */
    private function conjectureArrangements(array $windowSegmentIds): SupportCollection
    {
        $conjectures = Conjecture::where('type', ConjectureType::Reordering)
            ->whereHas('orderingEntries', fn ($query) => $query->where('part', '>', 1))
            ->whereHas('orderingEntries', fn ($query) => $query->whereIn('segment_id', $windowSegmentIds))
            ->with(['orderingEntries.segment:id,label,sort_key', 'user:id,name'])
            ->get();

        return $conjectures->toBase()->map(function (Conjecture $conjecture) {
            $text = '';
            /** @var SupportCollection<int, Assignment> $assignments */
            $assignments = new SupportCollection;
            $standInId = -1;

            foreach ($conjecture->orderingEntries->sortBy('sequence') as $entry) {
                $text .= $text === '' ? '' : "\n";
                $start = mb_strlen($text);
                $text .= trim((string) $entry->text);

                $assignment = new Assignment([
                    'segment_id' => $entry->segment_id,
                    'part' => $entry->part,
                    'start_offset' => $start,
                    'end_offset' => mb_strlen($text),
                ]);
                $assignment->id = $standInId--;
                $assignment->setRelation('segment', $entry->segment);
                $assignments->push($assignment);
            }

            return [
                'name' => ($conjecture->proposed_by ?? $conjecture->user->name).' (conjecture)',
                'text' => $text,
                'assignments' => $assignments,
                'conjecture_id' => $conjecture->id,
            ];
        });
    }

    /**
     * Apparatus-style statements of what a layer's displaced fragments did,
     * keyed by segment id — the scholarly reading of the ⇄ data.
     *
     * A fragment is DISPLACED when it does not physically sit right after the
     * part it follows in content order. Two displaced fragments of different
     * segments whose physical and content predecessors cross-match have
     * changed places, and are reported as the single exchange an apparatus
     * would print ("R2: 4 2/2 \"πάρεστιν ἐνταυθοῖ γυνή·\" has exchanged
     * places with 5 2/2 \"κωμῆτις ἥδʼ ἐξέρχεται.\"") rather than as two
     * segments each standing in two places. A displaced fragment with no
     * exchange partner is located against its physical neighbour ("B: 1.1
     * 2/2 \"fox\" stands after 1.2"). Fragments are assigned by part number
     * plus their full verbatim text — a digital apparatus never abbreviates
     * a lemma.
     *
     * @param  SupportCollection<int, Assignment>  $assignments
     * @return array<int, list<string>>
     */
    private function transpositionStatements(string $siglum, string $text, SupportCollection $assignments): array
    {
        $byOffset = $assignments->sortBy('start_offset')->values();

        /** @var array<int, Assignment|null> $physicalPred */
        $physicalPred = [];
        /** @var array<int, Assignment|null> $physicalNext */
        $physicalNext = [];
        foreach ($byOffset as $index => $assignment) {
            $physicalPred[$assignment->id] = $byOffset[$index - 1] ?? null;
            $physicalNext[$assignment->id] = $byOffset[$index + 1] ?? null;
        }

        /** @var array<int, Assignment|null> $contentPred */
        $contentPred = [];
        /** @var array<int, int> $partTotals */
        $partTotals = [];
        foreach ($assignments->groupBy('segment_id') as $segmentId => $parts) {
            $partTotals[$segmentId] = $parts->count();
            $ordered = Assignment::sortByPartOrder($parts)->values();
            foreach ($ordered as $index => $assignment) {
                $contentPred[$assignment->id] = $ordered[$index - 1] ?? null;
            }
        }

        // '4 2/2 "πάρεστιν ἐνταυθοῖ γυνή·"' — the fragment named by its
        // segment label and part number (the numbering the segment labels
        // already teach the reader) plus its verbatim text, whole: a digital
        // apparatus never abbreviates a lemma.
        $partRef = fn (Assignment $assignment): string => sprintf(
            '%s %d/%d "%s"',
            $assignment->segment->label,
            $assignment->part,
            $partTotals[$assignment->segment_id],
            preg_replace(
                '/\s+/u',
                ' ',
                trim(WordDivision::wordText($text, $assignment->start_offset, $assignment->end_offset)),
            ),
        );

        $displaced = $byOffset
            ->filter(fn (Assignment $assignment) => ($contentPred[$assignment->id] ?? null) !== null
                && $physicalPred[$assignment->id]?->id !== $contentPred[$assignment->id]->id)
            ->values();

        $statements = [];
        $paired = [];

        foreach ($displaced as $index => $fragment) {
            if (isset($paired[$fragment->id])) {
                continue;
            }

            foreach ($displaced->slice($index + 1) as $partner) {
                if (isset($paired[$partner->id]) || $partner->segment_id === $fragment->segment_id) {
                    continue;
                }

                $exchanged = $physicalPred[$fragment->id]?->id === $contentPred[$partner->id]?->id
                    && $physicalPred[$partner->id]?->id === $contentPred[$fragment->id]?->id;

                if (! $exchanged) {
                    continue;
                }

                $paired[$fragment->id] = $paired[$partner->id] = true;

                [$first, $second] = $fragment->segment->sort_key <= $partner->segment->sort_key
                    ? [$fragment, $partner]
                    : [$partner, $fragment];

                $statement = sprintf(
                    '%s: %s has exchanged places with %s',
                    $siglum,
                    $partRef($first),
                    $partRef($second),
                );
                $statements[$first->segment_id][] = $statement;
                $statements[$second->segment_id][] = $statement;
                break;
            }
        }

        foreach ($displaced as $fragment) {
            if (isset($paired[$fragment->id])) {
                continue;
            }

            $pred = $physicalPred[$fragment->id];
            $reference = $pred !== null
                ? 'after '.$pred->segment->label
                : ($physicalNext[$fragment->id] !== null ? 'before '.$physicalNext[$fragment->id]->segment->label : null);

            if ($reference === null) {
                continue;
            }

            $statements[$fragment->segment_id][] = sprintf(
                '%s: %s stands %s',
                $siglum,
                $partRef($fragment),
                $reference,
            );
        }

        return $statements;
    }

    /**
     * Everything segmentDetail() and materializedRuns() read per segment,
     * loaded ONCE for the whole window and grouped — a page of fifty lines
     * used to cost five queries a line (comments, unplaced conjectures,
     * columns with readings, selections, breaks), and the edition page's
     * response time grew with it.
     *
     * @param  SupportCollection<int, EditionSegment>  $window
     * @return WindowContext
     */
    private function windowContext(SupportCollection $window, Edition $edition): array
    {
        $segmentIds = $window->pluck('segment_id')->all();

        $lemmas = Lemma::whereIn('segment_id', $segmentIds)
            ->orderBy('position')
            ->with([
                'readings.transcriptionLayer:id,transcription_id,text',
                // Each reading's layer with its assignments of this work,
                // loaded once per layer: DiplomaticCounterpart reads them
                // for every candidate (see the note in show()).
                'readings.transcriptionLayer.assignments' => fn ($query) => $query->whereHas('segment', fn ($q) => $q->where('work_id', $edition->work_id)),
                'readings.transcriptionLayer.transcription.witness:id,siglum',
                'readings.conjecture.user:id,name',
                'readings.conjecture.references.item',
            ])
            ->get();

        return [
            'segment_references' => BibliographyReference::where('edition_id', $edition->id)
                ->whereIn('segment_id', $segmentIds)
                ->with('item')
                ->orderBy('position')
                ->get()
                ->toBase()
                ->groupBy('segment_id'),
            'comments' => EditionComment::where('edition_id', $edition->id)
                ->whereIn('segment_id', $segmentIds)
                ->with('user:id,name')
                ->orderBy('id')
                ->get()
                ->toBase()
                ->groupBy('segment_id'),
            'unplaced' => Conjecture::whereIn('segment_id', $segmentIds)
                ->whereIn('type', [ConjectureType::Substitution, ConjectureType::Deletion, ConjectureType::Lacuna, ConjectureType::Supplement])
                ->whereDoesntHave('lemmaReadings')
                ->with(['user:id,name', 'references.item'])
                ->orderBy('id')
                ->get()
                ->toBase()
                ->groupBy('segment_id'),
            'lemmas' => $lemmas->toBase()->groupBy('segment_id'),
            'selections' => EditionLemma::where('edition_id', $edition->id)
                ->whereIn('lemma_id', $lemmas->pluck('id'))
                ->with('selectedReading')
                ->get()
                ->keyBy('lemma_id'),
            'breaks' => EditionLineBreak::where('edition_id', $edition->id)
                ->whereIn('segment_id', $segmentIds)
                ->get()
                ->keyBy('lemma_id'),
            'paratexts' => EditionParatext::where('edition_id', $edition->id)
                ->whereIn('segment_id', $segmentIds)
                ->orderBy('position')
                ->orderBy('id')
                ->get()
                ->toBase()
                ->groupBy('segment_id'),
            // The rows of every line printed in pieces, all parts — the
            // ones on this page need their siblings to find their words.
            'parts' => EditionSegment::where('edition_id', $edition->id)
                ->whereIn('segment_id', $segmentIds)
                ->orderBy('part')
                ->get(['id', 'segment_id', 'part', 'part_text'])
                ->toBase()
                ->groupBy('segment_id')
                ->filter(fn (SupportCollection $rows) => $rows->count() > 1),
        ];
    }

    /**
     * Which of the segment's runs this row prints. A whole segment prints
     * them all; a segment printed in pieces (see EditionSegment::$part)
     * has its parts' words matched, in the segment's own order, against
     * the runs' printed text. Words that no longer match — the printed
     * text changed since the arrangement was adopted — leave the division
     * stale: part 1 then prints the whole segment and the other parts
     * nothing, and the page says so.
     *
     * @param  SupportCollection<int, EditionSegment>|null  $parts
     * @param  list<array<string, mixed>>  $runs
     * @return array{parts: int, start: int, end: int, stale: bool}
     */
    private function partRange(EditionSegment $editionSegment, array $runs, ?SupportCollection $parts): array
    {
        $whole = ['parts' => 1, 'start' => 0, 'end' => count($runs) - 1, 'stale' => false];

        if ($parts === null || $parts->count() < 2) {
            return $whole;
        }

        $normalize = fn (string $text): string => trim((string) preg_replace('/\s+/u', ' ', $text));
        $ranges = [];
        $cursor = 0;
        $stale = false;

        foreach ($parts as $row) {
            $wanted = $normalize((string) $row->part_text);
            $found = null;

            for ($end = $cursor; $end < count($runs); $end++) {
                $text = $normalize(implode(' ', array_map(fn (array $run) => (string) $run['text'], array_slice($runs, $cursor, $end - $cursor + 1))));

                if ($text === $wanted) {
                    $found = $end;

                    break;
                }

                if (mb_strlen($text) > mb_strlen($wanted)) {
                    break;
                }
            }

            if ($found === null) {
                $stale = true;

                break;
            }

            $ranges[$row->part] = ['start' => $cursor, 'end' => $found];
            $cursor = $found + 1;
        }

        if ($stale || $cursor !== count($runs)) {
            return $editionSegment->part === 1
                ? $whole + ['parts' => $parts->count(), 'stale' => true]
                : ['parts' => $parts->count(), 'start' => 0, 'end' => -1, 'stale' => true];
        }

        return ['parts' => $parts->count(), 'stale' => false] + ($ranges[$editionSegment->part] ?? ['start' => 0, 'end' => -1]);
    }

    /**
     * @param  array<string, mixed>|null  $orderRange
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomaticLayers  each transcription's diplomatic layer, keyed by transcription id
     * @param  array<int, array{siglum: string, conjecture_id: int|null, matches_current: bool, parts: array<int, array{part: int, after_label: string|null}>, statements: list<string>}>  $discontinuousWitnesses
     * @param  WindowContext  $context
     * @return array<string, mixed>
     */
    private function segmentDetail(EditionSegment $editionSegment, Edition $edition, ?array $orderRange, SupportCollection $diplomaticLayers, Tokenization $tokenization, array $discontinuousWitnesses, array $context, ?int $previousEditionSegmentId): array
    {
        $segment = $editionSegment->segment;
        $base = $editionSegment->transcriptionLayer;
        $runs = $this->materializedRuns($segment, $base, $diplomaticLayers, $tokenization, $context);
        $division = $this->partRange($editionSegment, array_values($runs), $context['parts']->get($segment->id));

        return [
            'id' => $segment->id,
            'edition_segment_id' => $editionSegment->id,
            'previous_edition_segment_id' => $previousEditionSegmentId,
            'label' => $segment->label,
            // Which piece of the segment this row prints — a whole segment
            // is part 1 of 1 over all its runs; see EditionSegment::$part.
            'part' => $editionSegment->part,
            'parts' => $division['parts'],
            'run_start' => $division['start'],
            'run_end' => $division['end'],
            'division_stale' => $division['stale'],
            'order_range' => $orderRange,
            // This edition's own lineation for the segment boundary — seeded
            // once from the base transcription at add time, edition-owned
            // ever after. Within-segment breaks ride on the runs instead.
            'starts_new_line' => $editionSegment->starts_new_line,
            'starts_new_paragraph' => $editionSegment->starts_new_paragraph,
            // Witnesses whose text for this segment is physically
            // discontinuous — a transposition split it across two or more
            // places. Derived from the assignment spans, never stored, so it
            // can't drift out of sync with the transcription.
            'discontinuous_witnesses' => $discontinuousWitnesses,
            'base' => $base !== null ? [
                'transcription_layer_id' => $base->id,
                'witness_siglum' => $base->transcription->witness->siglum,
            ] : null,
            'runs' => array_map(fn (array $run) => $this->slimRun($run), $runs),
            // The chosen witness's own line as the manuscript has it.
            'base_diplomatic' => $base !== null
                ? DiplomaticCounterpart::forSegment($segment, $diplomaticLayers->get($base->transcription_id))
                : null,
            // This edition's own notes here — see EditionComment. An
            // unanchored one (lemma_id null) is about the whole segment.
            'comments' => ($context['comments'][$segment->id] ?? collect())
                ->map(fn (EditionComment $comment) => [
                    'id' => $comment->id,
                    'lemma_id' => $comment->lemma_id,
                    'range_end_lemma_id' => $comment->range_end_lemma_id,
                    'note' => $comment->note,
                    'author' => $comment->user->name,
                ])->values(),
            'unplacedConjectures' => ($context['unplaced'][$segment->id] ?? collect())
                ->map(fn (Conjecture $conjecture) => [
                    'id' => $conjecture->id,
                    'type' => $conjecture->type->value,
                    'supplements_conjecture_id' => $conjecture->supplements_conjecture_id,
                    'label' => $this->conjectureLabel($conjecture),
                    'text' => $this->conjectureDisplayText($conjecture),
                    'note' => $conjecture->note,
                    'references' => $this->citations($conjecture->references),
                ])->values(),
            // The literature this edition cites on the segment as a whole
            // — see BibliographyReference.
            'references' => $this->citations($context['segment_references'][$segment->id] ?? collect()),
            // What the edition prints beside or among this segment's words
            // without its being text of the work — see EditionParatext.
            'paratexts' => $this->paratextsOf(
                array_values($runs),
                ($context['lemmas'][$segment->id] ?? collect())->values(),
                $context['paratexts'][$segment->id] ?? collect(),
            ),
        ];
    }

    /**
     * A segment's paratexts resolved against the run walk, exactly as its
     * line breaks are (see withBreaks): a paratext stands before or after
     * one column, and the run covering that column — which may be a range
     * selection or the base's wider reading swallowing it — is where it
     * prints. `run_index` is that run's index; `placement` says which side.
     *
     * @param  list<array<string, mixed>>  $runs
     * @param  SupportCollection<int, Lemma>  $lemmas
     * @param  SupportCollection<int, EditionParatext>  $paratexts
     * @return list<array{id: int, lemma_id: int, placement: string, kind: string, text: string, position: int, run_index: int}>
     */
    private function paratextsOf(array $runs, SupportCollection $lemmas, SupportCollection $paratexts): array
    {
        $indexOf = $lemmas->pluck('id')->flip();
        $runOfLemmaIndex = [];

        foreach ($runs as $i => $run) {
            $startIndex = $indexOf[$run['lemma_id']] ?? null;

            if ($startIndex === null) {
                continue;
            }

            $endIndex = $run['range_end_lemma_id'] !== null
                ? ($indexOf[$run['range_end_lemma_id']] ?? $startIndex)
                : $startIndex;

            for ($j = $startIndex; $j <= $endIndex; $j++) {
                $runOfLemmaIndex[$j] = $i;
            }
        }

        $resolved = [];

        foreach ($paratexts as $paratext) {
            $lemmaIndex = $indexOf[$paratext->lemma_id] ?? null;
            $runIndex = $lemmaIndex !== null ? ($runOfLemmaIndex[$lemmaIndex] ?? null) : null;

            if ($runIndex === null) {
                continue;
            }

            $resolved[] = [
                'id' => $paratext->id,
                'lemma_id' => $paratext->lemma_id,
                'placement' => $paratext->placement,
                'kind' => $paratext->kind->value,
                'text' => $paratext->text,
                'position' => $paratext->position,
                'run_index' => $runIndex,
            ];
        }

        return $resolved;
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
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomaticLayers  each transcription's diplomatic layer, keyed by transcription id
     * @param  WindowContext  $context
     * @return array<int, array<string, mixed>>
     */
    private function materializedRuns(Segment $segment, ?TranscriptionLayer $base, SupportCollection $diplomaticLayers, Tokenization $tokenization, array $context): array
    {
        $lemmas = ($context['lemmas'][$segment->id] ?? collect())->values();
        $selections = $context['selections'];

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
                $runs[] = $this->materializedRangeRun($lemma, $rangeEndLemma, $selection, $base, $byId, $segment, $diplomaticLayers, $tokenization);
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
            // does. The base's *omission* of a run of columns (see
            // LemmaReading::$omitted) is jumped the same way, so what it
            // lacks prints as one gap rather than one per column.
            $baseReading = $this->baseReadingOf($lemma, $base);
            $baseSpan = $baseReading ?? $this->baseOmissionOf($lemma, $base);
            $baseRangeEnd = $baseSpan?->range_end_lemma_id !== null
                ? $byId->get($baseSpan->range_end_lemma_id)
                : null;

            $runs[] = $this->materializedSingleRun($lemma, $selection, $base, $lastBaseEnd, $byId, $segment, $diplomaticLayers, $tokenization, $baseRangeEnd);
            $lastBaseEnd = $baseReading->end_offset ?? $lastBaseEnd;

            $coveredUntil = $baseRangeEnd !== null
                ? $lemmas->search(fn (Lemma $candidate) => $candidate->id === $baseRangeEnd->id)
                : false;

            $index = $coveredUntil !== false ? $coveredUntil + 1 : $index + 1;
        }

        return $this->withBreaks($runs, $lemmas, $context['breaks']);
    }

    /**
     * Resolve this edition's within-segment line breaks (EditionLineBreak —
     * its colometry) against the run walk, not the raw column list: runs
     * skip columns a range selection or the base's wider reading covers, so
     * a break anchored to a swallowed column has no run of its own and folds
     * onto the run covering it (rendering before that run — the closest
     * expressible position).
     *
     * @param  array<int, array<string, mixed>>  $runs
     * @param  SupportCollection<int, Lemma>  $lemmas
     * @param  EloquentCollection<array-key, EditionLineBreak>  $breaks  this edition's breaks on the window, keyed by lemma id
     * @return array<int, array<string, mixed>>
     */
    private function withBreaks(array $runs, SupportCollection $lemmas, EloquentCollection $breaks): array
    {
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
     * against a conjecture reading's own null transcription_layer_id. Never
     * the base's omission reading either — that says the base has no word
     * here, which is what a null answer means.
     */
    private function baseReadingOf(Lemma $lemma, ?TranscriptionLayer $base): ?LemmaReading
    {
        if ($base === null) {
            return null;
        }

        return $lemma->readings->first(
            fn (LemmaReading $reading) => $reading->transcription_layer_id === $base->id && ! $reading->omitted
        );
    }

    /**
     * The base's own omission reading anchored at a lemma, if it lacks the
     * column — see LemmaReading::$omitted. What it spans is printed as one
     * gap, not one per column.
     */
    private function baseOmissionOf(Lemma $lemma, ?TranscriptionLayer $base): ?LemmaReading
    {
        if ($base === null) {
            return null;
        }

        return $lemma->readings->first(
            fn (LemmaReading $reading) => $reading->transcription_layer_id === $base->id && $reading->omitted
        );
    }

    /**
     * @param  SupportCollection<int, Lemma>  $byId
     * @param  Lemma|null  $baseRangeEnd  last column the base's own reading here covers, when it spans more than this one
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomaticLayers  each transcription's diplomatic layer, keyed by transcription id
     * @return array<string, mixed>
     */
    private function materializedSingleRun(Lemma $lemma, ?EditionLemma $selection, ?TranscriptionLayer $base, ?int $lastBaseEnd, SupportCollection $byId, Segment $segment, SupportCollection $diplomaticLayers, Tokenization $tokenization, ?Lemma $baseRangeEnd = null): array
    {
        $selectedReadingId = $selection->selected_reading_id ?? null;
        $baseReading = $this->baseReadingOf($lemma, $base);

        $candidates = $this->materializedCandidates($lemma, $selectedReadingId, $base, $byId, $segment, $diplomaticLayers, $tokenization);

        // With nothing selected the base's own wording stands. Where the base
        // has no reading here it prints *nothing* and the run is a gap: a
        // witness that omits a word the others have must not be made to say
        // another manuscript's word for it. Only a segment with no base
        // transcription at all (a whole-line lacuna, see
        // EditionVariantController::storeWholeLineLacuna) falls back to a
        // candidate, having no base to speak for it.
        $selectedCandidate = $candidates->first(fn (array $candidate) => $candidate['selected']);
        $isGap = $selectedCandidate === null && $baseReading === null && $base !== null;
        // Nothing printed here on purpose — the base lacks the words, or an
        // omission/deletion was adopted — as opposed to nothing printed
        // because nothing exists yet (a conjecture-only column).
        $omitted = $isGap || ($selectedCandidate['omitted'] ?? false);

        $text = $selectedCandidate['text']
            ?? match (true) {
                $baseReading !== null => WordDivision::wordText($baseReading->transcriptionLayer->text, $baseReading->start_offset, $baseReading->end_offset),
                $isGap => '',
                default => $candidates->first()['text'] ?? '',
            };

        $baseStart = $baseReading->start_offset ?? $lastBaseEnd;
        $baseEnd = $baseReading->end_offset ?? $lastBaseEnd;

        // What the base manuscript itself shows for these words, so a reader
        // can see through the printed text token by token.
        $diplomatic = $baseReading !== null && $base !== null
            ? DiplomaticCounterpart::forSpan($segment, $base, $diplomaticLayers->get($base->transcription_id), $baseReading->start_offset, $baseReading->end_offset, $tokenization)
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
            'omitted' => $omitted,
            'candidates' => $candidates->all(),
            'extent_characters' => $selectedCandidate['extent_characters'] ?? null,
            'diplomatic' => $diplomatic,
            'orthographic_variation' => $this->orthographicVariation($candidates, $base),
        ];
    }

    /**
     * A run collapsed from several existing lemmas into one, because the
     * currently-selected reading spans them (an editor's multi-word
     * conjecture, or a witness's own reading SegmentAligner determined
     * doesn't decompose word-for-word — see LemmaReading::range_end_lemma_id).
     * Candidates are every reading on the *anchor* lemma, unfiltered by
     * their own range — a differently-shaped alternative (a different
     * range_end, or a plain single-word reading) is just as valid a
     * candidate to switch to as an identically-shaped one.
     *
     * @param  SupportCollection<int, Lemma>  $byId
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomaticLayers  each transcription's diplomatic layer, keyed by transcription id
     * @return array<string, mixed>
     */
    private function materializedRangeRun(Lemma $startLemma, Lemma $endLemma, EditionLemma $selection, ?TranscriptionLayer $base, SupportCollection $byId, Segment $segment, SupportCollection $diplomaticLayers, Tokenization $tokenization): array
    {
        $candidates = $this->materializedCandidates($startLemma, $selection->selected_reading_id, $base, $byId, $segment, $diplomaticLayers, $tokenization);
        $selectedCandidate = $candidates->first(fn (array $candidate) => $candidate['selected']);

        $startReading = $this->baseReadingOf($startLemma, $base);
        $endReading = $this->baseReadingOf($endLemma, $base);

        $diplomatic = $startReading !== null && $endReading !== null && $base !== null
            ? DiplomaticCounterpart::forSpan($segment, $base, $diplomaticLayers->get($base->transcription_id), $startReading->start_offset, $endReading->end_offset, $tokenization)
            : null;

        return [
            'lemma_id' => $startLemma->id,
            'range_end_lemma_id' => $endLemma->id,
            'base_start' => $startReading->start_offset ?? null,
            'base_end' => $endReading->end_offset ?? null,
            'text' => $selectedCandidate['text'] ?? '',
            'decided' => true,
            'gap' => false,
            'omitted' => $selectedCandidate['omitted'] ?? false,
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
     * witness first touched the segment.
     *
     * @param  SupportCollection<int, Lemma>  $byId
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomaticLayers  each transcription's diplomatic layer, keyed by transcription id
     * @return SupportCollection<int, array<string, mixed>>
     */
    private function materializedCandidates(Lemma $lemma, ?int $selectedReadingId, ?TranscriptionLayer $base, SupportCollection $byId, Segment $segment, SupportCollection $diplomaticLayers, Tokenization $tokenization): SupportCollection
    {
        $referenceEnd = $this->widestRangeEnd($lemma, $byId);

        return $lemma->readings
            ->sortBy(fn (LemmaReading $reading): string => match (true) {
                $base !== null && $reading->transcription_layer_id === $base->id => '0',
                $reading->transcription_layer_id !== null => '1'.$reading->transcriptionLayer->transcription->witness->siglum,
                default => '2'.str_pad((string) $reading->id, 12, '0', STR_PAD_LEFT),
            })
            ->map(
                fn (LemmaReading $reading): array => $this->materializedCandidate($reading, $selectedReadingId, $lemma, $base, $byId, $referenceEnd, $segment, $diplomaticLayers, $tokenization)
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
     * `omitted` marks a candidate that prints nothing if picked: a witness's
     * omission of these columns (LemmaReading::$omitted) or a deletion
     * conjecture. Its `text` is empty — the client says "omitted" or
     * "deleted" in words.
     *
     * @param  SupportCollection<int, Lemma>  $byId
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomaticLayers  each transcription's diplomatic layer, keyed by transcription id
     * @return array<string, mixed>
     */
    private function materializedCandidate(LemmaReading $reading, ?int $selectedReadingId, Lemma $anchor, ?TranscriptionLayer $base, SupportCollection $byId, ?Lemma $referenceEnd, Segment $segment, SupportCollection $diplomaticLayers, Tokenization $tokenization): array
    {
        $replacedText = $this->replacedSpanText($reading, $anchor, $base, $byId);
        $extension = $this->witnessExtension($reading, $anchor, $referenceEnd);
        $baseReading = $this->baseReadingOf($anchor, $base);
        $baseText = $baseReading !== null
            ? WordDivision::wordText($baseReading->transcriptionLayer->text, $baseReading->start_offset, $baseReading->end_offset)
            : null;

        if ($reading->omitted) {
            return [
                'key' => 'reading:'.$reading->id,
                'label' => $reading->transcriptionLayer->transcription->witness->siglum,
                'text' => '',
                'omitted' => true,
                'selected' => $reading->id === $selectedReadingId,
                'reading_id' => $reading->id,
                'transcription_layer_id' => $reading->transcription_layer_id,
                'start_offset' => $reading->start_offset,
                'end_offset' => $reading->end_offset,
                'conjecture_id' => null,
                'conjecture_type' => null,
                'supplements_conjecture_id' => null,
                'references' => [],
                'note' => null,
                'range_end_lemma_id' => $reading->range_end_lemma_id,
                'replaced_text' => $replacedText,
                'extent_characters' => null,
                'needs_review' => false,
                'orthographic_only' => false,
                'diplomatic' => null,
            ];
        }

        if ($reading->transcription_layer_id !== null) {
            return [
                'key' => 'reading:'.$reading->id,
                'label' => $reading->transcriptionLayer->transcription->witness->siglum,
                'text' => $extension['text'] ?? WordDivision::wordText($reading->transcriptionLayer->text, $reading->start_offset, $reading->end_offset),
                'omitted' => false,
                'selected' => $reading->id === $selectedReadingId,
                'reading_id' => $reading->id,
                'transcription_layer_id' => $reading->transcription_layer_id,
                'start_offset' => $reading->start_offset,
                'end_offset' => $extension['end_offset'] ?? $reading->end_offset,
                'conjecture_id' => null,
                'conjecture_type' => null,
                'supplements_conjecture_id' => null,
                'references' => [],
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
                    $extension['text'] ?? WordDivision::wordText($reading->transcriptionLayer->text, $reading->start_offset, $reading->end_offset),
                ),
                'diplomatic' => DiplomaticCounterpart::forSpan(
                    $segment,
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
            'omitted' => $reading->conjecture->type === ConjectureType::Deletion,
            'selected' => $reading->id === $selectedReadingId,
            'reading_id' => $reading->id,
            'transcription_layer_id' => null,
            'start_offset' => null,
            'end_offset' => null,
            'conjecture_id' => $reading->conjecture_id,
            'conjecture_type' => $reading->conjecture->type->value,
            'supplements_conjecture_id' => $reading->conjecture->supplements_conjecture_id,
            'references' => $this->citations($reading->conjecture->references),
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

        return WordDivision::wordText($base->text, $startReading->start_offset, $endReading->end_offset);
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
     * matching wider reading on the spot, exactly as if SegmentAligner
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
        if ($reading->transcription_layer_id === null || $reading->omitted || $reading->range_end_lemma_id !== null || $referenceEnd === null) {
            return null;
        }

        $alreadyExtended = $anchor->readings->contains(
            fn (LemmaReading $sibling) => $sibling->transcription_layer_id === $reading->transcription_layer_id
                && ! $sibling->omitted
                && $sibling->range_end_lemma_id === $referenceEnd->id
        );

        if ($alreadyExtended) {
            return null;
        }

        $endReading = $referenceEnd->readings->first(
            fn (LemmaReading $r) => $r->transcription_layer_id === $reading->transcription_layer_id && ! $r->omitted
        );

        if ($endReading === null) {
            return null;
        }

        return [
            'text' => WordDivision::wordText($reading->transcriptionLayer->text, $reading->start_offset, $endReading->end_offset),
            'end_offset' => $endReading->end_offset,
            'range_end_lemma_id' => $referenceEnd->id,
        ];
    }

    /**
     * The proposer with the kind of proposal spelled out in full — "Bergk
     * (conjecture)", "Wolf (lacuna)" — the way an apparatus credits a
     * reading to its author. Words, never abbreviations: space is not
     * scarce in a digital edition (user decision). A transposition/
     * reordering never reaches here (neither ever gets a LemmaReading —
     * they are order proposals applied to stored positions, see
     * EditionTransposition); both cases only exist for match exhaustiveness.
     */
    private function conjectureLabel(Conjecture $conjecture): string
    {
        $proposer = $conjecture->proposed_by ?? $conjecture->user->name;

        return match ($conjecture->type) {
            ConjectureType::Lacuna => $proposer.' (lacuna)',
            ConjectureType::Supplement => $proposer.' (supplement)',
            ConjectureType::Substitution => $proposer.' (conjecture)',
            ConjectureType::Deletion => $proposer.' (deletion)',
            ConjectureType::Transposition => $proposer.' (transposition)',
            ConjectureType::Reordering => $proposer.' (reordering)',
        };
    }

    /**
     * A lacuna's `text` is nullable — a bare lacuna (nothing proposed to
     * fill it) still needs *something* to display in the continuous text.
     * A substitution/supplement always has text; a deletion prints nothing
     * (the client marks the place — see the run's `omitted`); a
     * transposition never reaches here.
     */
    private function conjectureDisplayText(Conjecture $conjecture): string
    {
        if ($conjecture->text !== null) {
            return $conjecture->text;
        }

        if ($conjecture->type === ConjectureType::Deletion) {
            return '';
        }

        return $conjecture->extent !== null ? "[lacuna: {$conjecture->extent}]" : '[lacuna]';
    }
}
