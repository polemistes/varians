<?php

namespace App\Http\Controllers;

use App\Enums\ConjectureType;
use App\Enums\Layer;
use App\Enums\Tokenization;
use App\Http\Requests\StoreEditionRequest;
use App\Http\Requests\UpdateEditionRequest;
use App\Models\BibliographyItem;
use App\Models\BibliographyReference;
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
use App\Models\ManuscriptImage;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Work;
use App\Support\Bibliography\Biblatex;
use App\Support\Bibliography\EditionBibliography;
use App\Support\Bibliography\ReferenceFormatter;
use App\Support\Bibliography\Suggestions;
use App\Support\Edition\ConjectureCatalogue;
use App\Support\Edition\DiplomaticCounterpart;
use App\Support\Edition\PermutationBlocks;
use App\Support\Edition\TranspositionProjection;
use App\Support\Transcription\GreekText;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection as SupportCollection;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

/**
 * @phpstan-type WindowContext array{comments: SupportCollection<array-key, SupportCollection<int, EditionComment>>, unplaced: SupportCollection<array-key, SupportCollection<int, Conjecture>>, lemmas: SupportCollection<array-key, SupportCollection<int, Lemma>>, selections: EloquentCollection<array-key, EditionLemma>, breaks: EloquentCollection<array-key, EditionLineBreak>, passage_references: SupportCollection<array-key, SupportCollection<int, BibliographyReference>>, parts: SupportCollection<array-key, SupportCollection<int, EditionPassage>>}
 * @phpstan-type Citation array{id: int, item_id: int, label: string, citation: string, prenote: string|null, postnote: string|null}
 */
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
        $offset = ($page - 1) * self::WINDOW;
        $window = $orderedPassages->slice($offset, self::WINDOW)->values();

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
                'transcription.witness:id,siglum,label',
                'segments' => fn ($query) => $query->whereHas('canonicalPassage', fn ($q) => $q->where('work_id', $work->id)),
                'segments.canonicalPassage:id,work_id,address,sort_key,label',
            ])
            ->get(['id', 'transcription_id', 'text', 'layer']);

        // Over the WHOLE edition, not the page: a witness that moves a line
        // across the page boundary is a disagreement the editor must still
        // be shown. Keyed by canonical passage id.
        $orderRanges = $this->orderRanges($orderedPassages, $transcriptions);
        $discontinuities = $this->citationDiscontinuities(
            $transcriptions,
            $this->conjectureArrangements(array_values(array_map('intval', $window->pluck('canonical_passage_id')->all()))),
            $orderedPassages,
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
            'passages' => $this->annotatePassageStatus($orderedPassages->unique('canonical_passage_id')->values(), $edition),
            'windowPassages' => $window->values()
                ->map(fn (EditionPassage $editionPassage, int $index) => $this->passageDetail(
                    $editionPassage,
                    $edition,
                    $orderRanges[$editionPassage->canonical_passage_id] ?? null,
                    $diplomaticLayers,
                    $work->tokenization,
                    $discontinuities[$editionPassage->canonical_passage_id] ?? [],
                    $context,
                    // The printed predecessor, which for the first passage
                    // of page 2+ sits on the previous page — the whole-line
                    // lacuna marker anchors there, not at the edition's start.
                    $offset + $index > 0 ? $orderedPassages->get($offset + $index - 1)?->id : null,
                ))
                ->values(),
            // The work's *entire* citation space, regardless of what's in
            // this edition yet — the bulk "base a range" picker searches a
            // citation range for segments to add, so it must be able to
            // name a range that isn't in the edition at all yet (unlike
            // `passages` above, which is deliberately scoped to what's
            // already been added). Sort keys let the page widen a
            // registered rearrangement to citation contiguity.
            'workPassages' => $work->canonicalPassages()->orderBy('sort_key')->get(['id', 'address', 'label', 'sort_key']),
            // The work's conjectures as the Work page lists them, so a
            // conjecture named in a notice can be edited in place (editors)
            // or opened for its bibliography (readers).
            'workConjectures' => ConjectureCatalogue::forWork($work),
            // Which conjectures this edition follows — the page marks those
            // candidates as followed in the order panel.
            'transpositions' => EditionTransposition::where('edition_id', $edition->id)
                ->get(['id', 'conjecture_id'])
                ->map(fn (EditionTransposition $adoption) => [
                    'id' => $adoption->id,
                    'conjecture_id' => $adoption->conjecture_id,
                ])->values(),
            // Each transcription's own text/segments, for the "Add text"
            // panel's selection view — scoped to segments citing *this*
            // work, since a transcription can carry citations into more
            // than one work. Shaped explicitly so the panel can name each
            // transcript (witness siglum/label + the transcription's own
            // name) instead of falling back to a bare layer id.
            'transcriptions' => $transcriptions->map(fn (TranscriptionLayer $layer) => [
                'id' => $layer->id,
                'name' => $layer->transcription->name,
                'segments' => $layer->segments->map(fn (TranscriptionSegment $segment) => [
                    'id' => $segment->id,
                    'canonical_passage_id' => $segment->canonical_passage_id,
                ])->values(),
                'witness' => [
                    'id' => $layer->transcription->witness->id,
                    'siglum' => $layer->transcription->witness->siglum,
                    'label' => $layer->transcription->witness->label,
                ],
            ])->values(),
            // Every layer of every witness, whole, for the witnesses pane —
            // where a manuscript is read and its segments are picked for
            // the edition. Both layers, unlike `transcriptions` above.
            'witnessTranscripts' => $this->witnessTranscripts($transcriptions, $diplomaticLayers, $request->user()),
            'referenceLevels' => $work->referenceScheme->levels,
            // Every visible witness citing the work, not only those this
            // edition draws on — what is available, and what was left aside.
            'witnesses' => $this->witnessesCiting($transcriptions, $editionPassages),
            // Every item this edition cites — from its passages and from
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
     * The witnesses behind the visible normalized layers citing the work,
     * by siglum, each marked whether a passage of this edition is based on
     * one of its transcripts.
     *
     * @param  SupportCollection<int, TranscriptionLayer>  $transcriptions
     * @param  SupportCollection<int, EditionPassage>  $editionPassages
     * @return list<array{id: int, siglum: string, label: string|null, in_edition: bool}>
     */
    private function witnessesCiting(SupportCollection $transcriptions, SupportCollection $editionPassages): array
    {
        $baseWitnessIds = $editionPassages
            ->map(fn (EditionPassage $editionPassage) => $editionPassage->transcriptionLayer?->transcription->witness_id)
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
     * The citations of one thing, as the apparatus prints them.
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
     * The edition's bibliography: every item cited by one of its passages,
     * or by a conjecture placed (as a reading) on one of its passages —
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
     * Every visible transcript of the work, in both layers, WHOLE — the
     * witnesses pane is where segments are picked for adding, so it shows
     * the manuscript's full text with every citation, greying out what the
     * edition already has (user decision, replacing the window slice). A
     * diplomatic entry names its normalized sibling, the only layer an add
     * may source.
     *
     * @param  SupportCollection<int, TranscriptionLayer>  $normalized
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomatic
     * @return array<int, array<string, mixed>>
     */
    private function witnessTranscripts(SupportCollection $normalized, SupportCollection $diplomatic, ?User $viewer): array
    {
        $normalizedIdByTranscription = $normalized->keyBy('transcription_id')->map(fn (TranscriptionLayer $layer) => $layer->id);
        $layers = $normalized->values()->merge($diplomatic->values());

        // Pages and page breaks belong to the transcription and the witness;
        // photographs are filtered like everything else the viewer may see.
        foreach ($layers as $layer) {
            $layer->transcription->loadMissing(['pageBreaks.manuscriptPage', 'witness.pages']);
        }

        $imagesByPage = ManuscriptImage::visibleTo($viewer)
            ->whereIn('witness_id', $layers->map(fn (TranscriptionLayer $layer) => $layer->transcription->witness_id)->unique())
            ->orderBy('position')
            ->get()
            ->groupBy('manuscript_page_id');

        return $layers
            ->map(fn (TranscriptionLayer $transcription) => [
                'id' => $transcription->id,
                'transcription_id' => $transcription->transcription_id,
                'normalized_layer_id' => $normalizedIdByTranscription->get($transcription->transcription_id),
                'name' => $transcription->transcription->name,
                'witness_id' => $transcription->transcription->witness_id,
                'siglum' => $transcription->transcription->witness->siglum,
                'layer' => $transcription->layer->value,
                'first_sort_key' => (string) ($transcription->segments->min(fn (TranscriptionSegment $segment) => $segment->canonicalPassage?->sort_key) ?? ''),
                ...$this->wholeTranscript($transcription),
                ...$this->pagesOf($transcription, $imagesByPage),
                // The layer's image alignments, so the image view can light
                // up a region for the edition line under the pointer and
                // the line for the region under it (user decision).
                'regions' => $transcription->regions()
                    ->orderBy('position')
                    ->get(['id', 'transcription_layer_id', 'manuscript_image_id', 'group_id', 'text', 'start_offset', 'end_offset', 'position', 'x', 'y', 'width', 'height', 'needs_review']),
            ])
            ->sortBy(fn (array $entry) => [$entry['siglum'], $entry['first_sort_key'], $entry['layer']])
            ->values()
            ->all();
    }

    /**
     * Where the manuscript's pages begin in this layer's text, and the
     * witness's pages with their photograph — the page-break lines the
     * witnesses pane draws in the text, and its image view (user decision).
     * A page break is held as a line (see TranscriptionPageBreak) and
     * resolved to this layer's own offset here.
     *
     * @param  SupportCollection<int, EloquentCollection<int, ManuscriptImage>>  $imagesByPage
     * @return array{page_breaks: list<array{manuscript_page_id: int, start_line: int, start_offset: int, label: string}>, pages: list<array{id: int, label: string, position: float, image: array{id: int, witness_id: int, manuscript_page_id: int, url: string, position: string}|null}>}
     */
    private function pagesOf(TranscriptionLayer $transcription, SupportCollection $imagesByPage): array
    {
        $breaks = [];

        foreach ($transcription->transcription->pageBreaks->sortBy('start_line') as $break) {
            $breaks[] = [
                'manuscript_page_id' => (int) $break->manuscript_page_id,
                'start_line' => (int) $break->start_line,
                'start_offset' => $transcription->offsetOfLine((int) $break->start_line),
                'label' => (string) ($break->manuscriptPage->label ?? ''),
            ];
        }

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

        return ['page_breaks' => $breaks, 'pages' => $pages];
    }

    /**
     * A transcript's full text and citations for the witnesses pane.
     *
     * @return array<string, mixed>
     */
    private function wholeTranscript(TranscriptionLayer $transcription): array
    {
        // Which part of its passage each span is, as a dense ordinal — raw
        // `part` values can carry gaps after merges and removals, and
        // AlignableText prints "label · ordinal/total" on a discontinuous
        // citation's badges.
        $partOrdinals = [];

        foreach ($transcription->segments->groupBy('canonical_passage_id') as $group) {
            foreach ($group->sortBy('part')->values() as $index => $segment) {
                $partOrdinals[$segment->id] = $index + 1;
            }
        }

        return [
            'text' => $transcription->text,
            'segments' => $transcription->segments
                ->sortBy('start_offset')
                ->map(fn (TranscriptionSegment $segment) => [
                    'id' => $segment->id,
                    'canonical_passage_id' => $segment->canonical_passage_id,
                    'start_offset' => $segment->start_offset,
                    'end_offset' => $segment->end_offset,
                    'part' => $segment->part,
                    'part_ordinal' => $partOrdinals[$segment->id],
                    'canonical_passage' => [
                        'id' => $segment->canonical_passage_id,
                        'label' => $segment->canonicalPassage?->label,
                    ],
                ])
                ->values()
                ->all(),
            'part_totals' => $transcription->segments
                ->groupBy('canonical_passage_id')
                ->map(fn (SupportCollection $group) => $group->count())
                ->all(),
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
     * Notices what no one asked it to: where a source — a witness's own
     * physical order, or a catalogued Transposition/Reordering conjecture —
     * orders passages DIFFERENTLY FROM THE PRINTED ORDER. See
     * PermutationBlocks for the decomposition itself, which is a strict
     * generalization of a plain adjacent swap (the smallest possible
     * non-identity block is size 2). Blocks from different sources are
     * merged wherever they overlap, since only one candidate list makes
     * sense for one span of the text. A transcription that doesn't cite
     * every passage in the final merged block can't offer a whole-block
     * candidate (mirrors how a fragmentary witness already can't extend
     * past what it covers elsewhere, see witnessExtension()) — it simply
     * isn't listed as a candidate for that block.
     *
     * The printed order is the reference, and CITATION ORDER IS NOT A
     * SOURCE (user decision): that the printed order, or a manuscript's,
     * departs from citation order is no news — the citation labels on the
     * lines already say so. What the editor needs surfacing is only where
     * what she PRINTS disagrees with a witness or with a catalogued
     * proposal. Citation order remains available inside a block as an
     * applyable candidate, it just never creates one. (An earlier design
     * diffed sources against citation order and flagged the editor's own
     * departure separately; both notices were noise by this measure.)
     *
     * A block's extent is the citation span of the disagreeing stretch
     * (min..max sort_key of its members), so its members may be scattered
     * in the printed order. Each member's window index carries the same
     * block info; `anchor` is true only on the first member in printed
     * order, which is where the client renders the one marker.
     *
     * This is a calm, always-derived report, like the ⇄ discontinuity
     * marker: it states that sources order these passages differently from
     * the printed text and offers each ordering as an applyable candidate.
     * There is no "settled" state to store or re-flag — the stored
     * positions are the decision, and a block where nothing disagrees with
     * them simply shows nothing.
     *
     * @param  SupportCollection<int, EditionPassage>  $printed  the whole edition, in printed order
     * @param  SupportCollection<int, TranscriptionLayer>  $transcriptions  Each with `segments` (and `segments.canonicalPassage`) and `witness` already eager-loaded — see show().
     * @return array<int, array<string, mixed>> keyed by canonical passage id
     */
    private function orderRanges(SupportCollection $printed, SupportCollection $transcriptions): array
    {
        // A line printed in pieces stands where its first part stands.
        $ordered = $printed->unique('canonical_passage_id')->values();

        if ($ordered->count() < 2) {
            return [];
        }

        $byCitation = $ordered
            ->sortBy(fn (EditionPassage $editionPassage) => $editionPassage->canonicalPassage->sort_key)
            ->values();

        $citationIndexOf = [];

        foreach ($byCitation as $index => $editionPassage) {
            $citationIndexOf[$editionPassage->canonical_passage_id] = $index;
        }

        $printedIndexOf = [];

        foreach ($ordered as $index => $editionPassage) {
            $printedIndexOf[$editionPassage->canonical_passage_id] = $index;
        }

        // One source's disagreement with the printed order, as citation-
        // index blocks: the source's subset is laid out in printed order,
        // permuted into the source's own order, and each non-identity
        // block's members map to their citation span.
        $blocksAgainstPrinted = function (array $subsetIds, array $sourceRankOf) use ($printedIndexOf, $citationIndexOf): array {
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
                $memberCitationIndexes = array_map(
                    fn (int $id) => $citationIndexOf[$id],
                    array_slice($inPrintedOrder, $localStart, $localEnd - $localStart + 1),
                );

                if ($memberCitationIndexes === []) {
                    continue;
                }

                $blocks[] = [min($memberCitationIndexes), max($memberCitationIndexes)];
            }

            return $blocks;
        };

        $indexBlocks = [];

        foreach ($transcriptions as $transcription) {
            // A passage's physical position is its *earliest* citation span.
            // Deliberate for a passage cited in several places: a transposed
            // part is a sub-passage matter, reported per passage via
            // citationDiscontinuities(), and must not drag the whole passage
            // into a whole-passage reorder block here.
            $offsetsByPassageId = $transcription->segments
                ->groupBy('canonical_passage_id')
                ->map(fn (SupportCollection $segments) => $segments->min('start_offset'));

            $citedIds = [];

            foreach ($ordered as $editionPassage) {
                if ($offsetsByPassageId->has($editionPassage->canonical_passage_id)) {
                    $citedIds[] = $editionPassage->canonical_passage_id;
                }
            }

            if (count($citedIds) < 2) {
                continue;
            }

            $rankOf = [];

            foreach (collect($citedIds)->sortBy(fn (int $id) => $offsetsByPassageId->get($id))->values() as $rank => $id) {
                $rankOf[$id] = $rank;
            }

            array_push($indexBlocks, ...$blocksAgainstPrinted($citedIds, $rankOf));
        }

        // Catalogued proposals are sources too: one creates a site the
        // moment the printed order stops (or never started) following it —
        // otherwise a proposal nobody has applied would be undiscoverable.
        // Both kinds come normalized to {ids, sequence} here: a
        // Reordering's stored entries, a Transposition's statement
        // projected onto its citation span.
        $conjectureSources = $this->conjectureOrderSources($byCitation, $citationIndexOf);

        foreach ($conjectureSources as $source) {
            array_push($indexBlocks, ...$blocksAgainstPrinted($source['ids'], array_flip($source['sequence'])));
        }

        $ranges = [];

        foreach ($this->mergeIndexBlocks($indexBlocks) as [$startIndex, $endIndex]) {
            $members = $byCitation->slice($startIndex, $endIndex - $startIndex + 1)->values();
            $rangeInfo = $this->buildOrderRangeInfo($ordered, $members, $transcriptions, $conjectureSources);

            if ($rangeInfo === null) {
                continue;
            }

            $memberIds = $members->pluck('canonical_passage_id')->flip();
            $anchored = false;

            foreach ($ordered as $editionPassage) {
                if ($memberIds->has($editionPassage->canonical_passage_id)) {
                    $ranges[$editionPassage->canonical_passage_id] = $rangeInfo + ['anchor' => ! $anchored];
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
     * - a Transposition is a statement, projected onto the citation span
     *   its anchors bracket (see TranspositionProjection). Every record
     *   counts: since the edition page registers the editor's own
     *   rearrangement as a conjecture deliberately, there are no silent
     *   working marks left to keep out.
     *
     * A proposal reaching passages outside the window is skipped, like a
     * fragmentary witness.
     *
     * @param  SupportCollection<int, EditionPassage>  $byCitation
     * @param  array<int, int>  $citationIndexOf
     * @return list<array{conjecture: Conjecture, ids: list<int>, sequence: list<int>}> ids in citation order; sequence the proposed order of the same set
     */
    private function conjectureOrderSources(SupportCollection $byCitation, array $citationIndexOf): array
    {
        $windowIds = $byCitation->pluck('canonical_passage_id')->all();
        $sources = [];

        $reorderings = Conjecture::where('type', ConjectureType::Reordering)
            ->whereHas('orderingEntries', fn ($query) => $query->whereIn('canonical_passage_id', $windowIds))
            ->with(['orderingEntries', 'user:id,name'])
            ->get();

        foreach ($reorderings as $conjecture) {
            // A divided passage stands where its first part stands, the
            // way a witness's split citation does in the order report.
            $entryIds = $conjecture->orderingEntries->pluck('canonical_passage_id')->unique()->values();

            if ($entryIds->count() < 2 || $entryIds->contains(fn (int $id) => ! array_key_exists($id, $citationIndexOf))) {
                continue;
            }

            $sources[] = [
                'conjecture' => $conjecture,
                'ids' => array_values($entryIds->sortBy(fn (int $id) => $citationIndexOf[$id])->all()),
                'sequence' => array_values($conjecture->orderingEntries->sortBy('sequence')->pluck('canonical_passage_id')->unique()->all()),
            ];
        }

        $transpositions = Conjecture::where('type', ConjectureType::Transposition)
            ->where(fn ($query) => $query
                ->whereIn('canonical_passage_id', $windowIds)
                ->orWhereIn('move_target_canonical_passage_id', $windowIds))
            ->with('user:id,name')
            ->get();

        foreach ($transpositions as $conjecture) {
            $anchors = [
                $conjecture->canonical_passage_id,
                $conjecture->transposition_range_end_canonical_passage_id ?? $conjecture->canonical_passage_id,
                $conjecture->move_target_canonical_passage_id,
            ];

            $anchorIndexes = [];

            foreach ($anchors as $anchor) {
                if ($anchor === null || ! array_key_exists($anchor, $citationIndexOf)) {
                    continue 2;
                }

                $anchorIndexes[] = $citationIndexOf[$anchor];
            }

            $memberIds = array_values($byCitation
                ->slice(min($anchorIndexes), max($anchorIndexes) - min($anchorIndexes) + 1)
                ->pluck('canonical_passage_id')
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
     * One block's report. `$members` are the block's passages in citation
     * order; `matches_current` compares each candidate against the members'
     * relative order as printed (they may be scattered among non-members in
     * the printed text — see orderRanges()). The block's endpoints are its
     * citation-order first and last member, which is also how the apply
     * endpoint re-derives membership (EditionOrderController).
     *
     * @param  SupportCollection<int, EditionPassage>  $ordered  the window, in printed order
     * @param  SupportCollection<int, EditionPassage>  $members  the block, in citation order
     * @param  SupportCollection<int, TranscriptionLayer>  $transcriptions
     * @param  list<array{conjecture: Conjecture, ids: list<int>, sequence: list<int>}>  $conjectureSources
     * @return array<string, mixed>|null
     */
    private function buildOrderRangeInfo(SupportCollection $ordered, SupportCollection $members, SupportCollection $transcriptions, array $conjectureSources): ?array
    {
        $memberIdSet = $members->pluck('canonical_passage_id')->flip();
        $labelByPassageId = $members->keyBy('canonical_passage_id');

        $currentMembers = $ordered->filter(
            fn (EditionPassage $editionPassage) => $memberIdSet->has($editionPassage->canonical_passage_id),
        )->values();
        $currentIds = $currentMembers->pluck('canonical_passage_id')->all();

        $citationSequence = $members->pluck('canonical_passage_id')->all();
        $memberCount = count($citationSequence);

        $candidates = [];

        // Citation order is always a candidate — the vulgate numbering an
        // apparatus reports transpositions against.
        $candidates[] = [
            'source' => 'citation',
            'transcription_layer_id' => null,
            'conjecture_id' => null,
            'proposed_by' => null,
            'sequence' => collect($citationSequence)->map(fn (int $id) => $labelByPassageId->get($id)?->canonicalPassage->label)->all(),
            'witness_siglum' => null,
            'matches_current' => $citationSequence === $currentIds,
        ];

        foreach ($transcriptions as $transcription) {
            $citedIds = $transcription->segments->pluck('canonical_passage_id')->unique();

            if ($citedIds->intersect($citationSequence)->count() !== $memberCount) {
                continue; // fragmentary — doesn't cite every passage in the block
            }

            $sequence = $transcription->segments
                ->whereIn('canonical_passage_id', $citationSequence)
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
                'matches_current' => $sequence === $currentIds,
            ];
        }

        foreach ($conjectureSources as $source) {
            if ($source['ids'] !== $citationSequence) {
                continue; // proposes an order for a different set than this block
            }

            $conjecture = $source['conjecture'];

            $candidates[] = [
                'source' => 'conjecture',
                'transcription_layer_id' => null,
                'conjecture_id' => $conjecture->id,
                'proposed_by' => $conjecture->proposed_by ?? $conjecture->user->name,
                'sequence' => collect($source['sequence'])->map(fn (int $id) => $labelByPassageId->get($id)?->canonicalPassage->label)->all(),
                'witness_siglum' => null,
                'matches_current' => $source['sequence'] === $currentIds,
            ];
        }

        // A block exists only where a WITNESS or a catalogued conjecture
        // disagrees with the printed order — the citation candidate alone
        // never keeps one alive (that the printed order departs from
        // citation order is no news; the line numbers say so). This bites
        // when the citation-span expansion swallowed the only disagreeing
        // witness's candidacy (fragmentary rule): the block then has
        // nothing to say and is dropped.
        $hasAlternative = collect($candidates)->contains(
            fn (array $candidate) => $candidate['source'] !== 'citation' && ! $candidate['matches_current'],
        );

        if (! $hasAlternative) {
            return null;
        }

        $startPassage = $members->first()->canonicalPassage;
        $endPassage = $members->last()->canonicalPassage;

        return [
            'range_key' => "{$startPassage->id}-{$endPassage->id}",
            'range_start_canonical_passage_id' => $startPassage->id,
            'range_end_canonical_passage_id' => $endPassage->id,
            // "6–7", for the one marker the block renders.
            'range_label' => $memberCount > 1 ? "{$startPassage->label}–{$endPassage->label}" : $startPassage->label,
            // Printed order of the members — the left column of the client's
            // slope graphs, and the reference `matches_current` is against.
            'member_canonical_passage_ids' => $currentIds,
            'current_sequence' => $currentMembers->map(fn (EditionPassage $editionPassage) => $editionPassage->canonicalPassage->label)->all(),
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
     *                                                                      Each entry also says whether the edition's own printed arrangement of
     *                                                                      the source's pieces is the same (`matches_current`) — the source the
     *                                                                      line's ordering follows, rather than a variant of it.
     * @param  SupportCollection<int, array{name: string, text: string, segments: SupportCollection<int, TranscriptionSegment>, conjecture_id: int}>  $arrangements
     * @param  SupportCollection<int, EditionPassage>  $printed  the whole edition's rows, in printed order
     * @return array<int, array<int, array{siglum: string, conjecture_id: int|null, matches_current: bool, parts: array<int, array{part: int, after_label: string|null}>, statements: list<string>}>>
     */
    private function citationDiscontinuities(SupportCollection $transcriptions, SupportCollection $arrangements, SupportCollection $printed): array
    {
        $result = [];
        $printedKeys = array_values($printed
            ->map(fn (EditionPassage $row) => [(int) $row->canonical_passage_id, (int) $row->part])
            ->all());

        foreach ($transcriptions as $layer) {
            foreach ($this->discontinuitiesOf($layer->transcription->witness->siglum, $layer->text, $layer->segments->toBase(), null, $printedKeys) as $passageId => $entries) {
                $result[$passageId] = [...($result[$passageId] ?? []), ...$entries];
            }
        }

        // A conjecture that divides a line is the same kind of source as a
        // witness that cites a line in two places, and is reported by the
        // same code (user decision).
        foreach ($arrangements as $arrangement) {
            foreach ($this->discontinuitiesOf($arrangement['name'], $arrangement['text'], $arrangement['segments'], $arrangement['conjecture_id'], $printedKeys) as $passageId => $entries) {
                $result[$passageId] = [...($result[$passageId] ?? []), ...$entries];
            }
        }

        return array_map(
            fn (array $witnesses) => collect($witnesses)->sortBy('siglum')->values()->all(),
            $result,
        );
    }

    /**
     * One source's split citations, keyed by canonical passage id.
     *
     * @param  SupportCollection<int, TranscriptionSegment>  $segments
     * @param  list<array{0: int, 1: int}>  $printedKeys  the edition's printed rows as (passage, part)
     * @return array<int, list<array{siglum: string, conjecture_id: int|null, matches_current: bool, parts: array<int, array{part: int, after_label: string|null}>, statements: list<string>}>>
     */
    private function discontinuitiesOf(string $siglum, string $text, SupportCollection $segments, ?int $conjectureId, array $printedKeys): array
    {
        $result = [];
        $byOffset = $segments->sortBy('start_offset')->values();
        $statements = $this->transpositionStatements($siglum, $text, $segments);

        // The source's arrangement of the passages it cites, as (passage,
        // part) in physical order, against the edition's printed rows of
        // the same passages: equal means the edition prints this
        // arrangement — it follows the source rather than varying from it.
        $sourceKeys = array_values($byOffset
            ->map(fn (TranscriptionSegment $segment) => [(int) $segment->canonical_passage_id, (int) $segment->part])
            ->all());
        $cited = array_flip(array_map(fn (array $key) => $key[0], $sourceKeys));
        $printedIds = array_flip(array_map(fn (array $key) => $key[0], $printedKeys));
        $matchesCurrent = array_values(array_filter($printedKeys, fn (array $key) => isset($cited[$key[0]])))
            === array_values(array_filter($sourceKeys, fn (array $key) => isset($printedIds[$key[0]])));

        foreach ($segments->groupBy('canonical_passage_id') as $passageId => $parts) {
            if ($parts->count() < 2) {
                continue;
            }

            $result[(int) $passageId][] = [
                'siglum' => $siglum,
                'conjecture_id' => $conjectureId,
                'matches_current' => $matchesCurrent,
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
                'statements' => $statements[$passageId] ?? [],
            ];
        }

        return $result;
    }

    /**
     * Reordering conjectures that divide a passage shown in the window,
     * each shaped like a transcript — the pieces laid end to end as text,
     * cited by unsaved TranscriptionSegment stand-ins — so the split
     * citation report reads them like a witness.
     *
     * @param  list<int>  $windowPassageIds
     * @return SupportCollection<int, array{name: string, text: string, segments: SupportCollection<int, TranscriptionSegment>, conjecture_id: int}>
     */
    private function conjectureArrangements(array $windowPassageIds): SupportCollection
    {
        $conjectures = Conjecture::where('type', ConjectureType::Reordering)
            ->whereHas('orderingEntries', fn ($query) => $query->where('part', '>', 1))
            ->whereHas('orderingEntries', fn ($query) => $query->whereIn('canonical_passage_id', $windowPassageIds))
            ->with(['orderingEntries.canonicalPassage:id,label,sort_key', 'user:id,name'])
            ->get();

        return $conjectures->toBase()->map(function (Conjecture $conjecture) {
            $text = '';
            /** @var SupportCollection<int, TranscriptionSegment> $segments */
            $segments = new SupportCollection;
            $standInId = -1;

            foreach ($conjecture->orderingEntries->sortBy('sequence') as $entry) {
                $text .= $text === '' ? '' : "\n";
                $start = mb_strlen($text);
                $text .= trim((string) $entry->text);

                $segment = new TranscriptionSegment([
                    'canonical_passage_id' => $entry->canonical_passage_id,
                    'part' => $entry->part,
                    'start_offset' => $start,
                    'end_offset' => mb_strlen($text),
                ]);
                $segment->id = $standInId--;
                $segment->setRelation('canonicalPassage', $entry->canonicalPassage);
                $segments->push($segment);
            }

            return [
                'name' => ($conjecture->proposed_by ?? $conjecture->user->name).' (conjecture)',
                'text' => $text,
                'segments' => $segments,
                'conjecture_id' => $conjecture->id,
            ];
        });
    }

    /**
     * Apparatus-style statements of what a layer's displaced fragments did,
     * keyed by canonical passage id — the scholarly reading of the ⇄ data.
     *
     * A fragment is DISPLACED when it does not physically sit right after the
     * part it follows in content order. Two displaced fragments of different
     * passages whose physical and content predecessors cross-match have
     * changed places, and are reported as the single exchange an apparatus
     * would print ("R2: 4 2/2 \"πάρεστιν ἐνταυθοῖ γυνή·\" has exchanged
     * places with 5 2/2 \"κωμῆτις ἥδʼ ἐξέρχεται.\"") rather than as two
     * passages each standing in two places. A displaced fragment with no
     * exchange partner is located against its physical neighbour ("B: 1.1
     * 2/2 \"fox\" stands after 1.2"). Fragments are cited by part number
     * plus their full verbatim text — a digital apparatus never abbreviates
     * a lemma.
     *
     * @param  SupportCollection<int, TranscriptionSegment>  $segments
     * @return array<int, list<string>>
     */
    private function transpositionStatements(string $siglum, string $text, SupportCollection $segments): array
    {
        $byOffset = $segments->sortBy('start_offset')->values();

        /** @var array<int, TranscriptionSegment|null> $physicalPred */
        $physicalPred = [];
        /** @var array<int, TranscriptionSegment|null> $physicalNext */
        $physicalNext = [];
        foreach ($byOffset as $index => $segment) {
            $physicalPred[$segment->id] = $byOffset[$index - 1] ?? null;
            $physicalNext[$segment->id] = $byOffset[$index + 1] ?? null;
        }

        /** @var array<int, TranscriptionSegment|null> $contentPred */
        $contentPred = [];
        /** @var array<int, int> $partTotals */
        $partTotals = [];
        foreach ($segments->groupBy('canonical_passage_id') as $passageId => $parts) {
            $partTotals[$passageId] = $parts->count();
            $ordered = TranscriptionSegment::sortByPartOrder($parts)->values();
            foreach ($ordered as $index => $segment) {
                $contentPred[$segment->id] = $ordered[$index - 1] ?? null;
            }
        }

        // '4 2/2 "πάρεστιν ἐνταυθοῖ γυνή·"' — the fragment named by its
        // passage label and part number (the numbering the citation labels
        // already teach the reader) plus its verbatim text, whole: a digital
        // apparatus never abbreviates a lemma.
        $partRef = fn (TranscriptionSegment $segment): string => sprintf(
            '%s %d/%d "%s"',
            $segment->canonicalPassage->label,
            $segment->part,
            $partTotals[$segment->canonical_passage_id],
            preg_replace(
                '/\s+/u',
                ' ',
                trim(mb_substr($text, $segment->start_offset, $segment->end_offset - $segment->start_offset)),
            ),
        );

        $displaced = $byOffset
            ->filter(fn (TranscriptionSegment $segment) => ($contentPred[$segment->id] ?? null) !== null
                && $physicalPred[$segment->id]?->id !== $contentPred[$segment->id]->id)
            ->values();

        $statements = [];
        $paired = [];

        foreach ($displaced as $index => $fragment) {
            if (isset($paired[$fragment->id])) {
                continue;
            }

            foreach ($displaced->slice($index + 1) as $partner) {
                if (isset($paired[$partner->id]) || $partner->canonical_passage_id === $fragment->canonical_passage_id) {
                    continue;
                }

                $exchanged = $physicalPred[$fragment->id]?->id === $contentPred[$partner->id]?->id
                    && $physicalPred[$partner->id]?->id === $contentPred[$fragment->id]?->id;

                if (! $exchanged) {
                    continue;
                }

                $paired[$fragment->id] = $paired[$partner->id] = true;

                [$first, $second] = $fragment->canonicalPassage->sort_key <= $partner->canonicalPassage->sort_key
                    ? [$fragment, $partner]
                    : [$partner, $fragment];

                $statement = sprintf(
                    '%s: %s has exchanged places with %s',
                    $siglum,
                    $partRef($first),
                    $partRef($second),
                );
                $statements[$first->canonical_passage_id][] = $statement;
                $statements[$second->canonical_passage_id][] = $statement;
                break;
            }
        }

        foreach ($displaced as $fragment) {
            if (isset($paired[$fragment->id])) {
                continue;
            }

            $pred = $physicalPred[$fragment->id];
            $reference = $pred !== null
                ? 'after '.$pred->canonicalPassage->label
                : ($physicalNext[$fragment->id] !== null ? 'before '.$physicalNext[$fragment->id]->canonicalPassage->label : null);

            if ($reference === null) {
                continue;
            }

            $statements[$fragment->canonical_passage_id][] = sprintf(
                '%s: %s stands %s',
                $siglum,
                $partRef($fragment),
                $reference,
            );
        }

        return $statements;
    }

    /**
     * Everything passageDetail() and materializedRuns() read per passage,
     * loaded ONCE for the whole window and grouped — a page of fifty lines
     * used to cost five queries a line (comments, unplaced conjectures,
     * columns with readings, selections, breaks), and the edition page's
     * response time grew with it.
     *
     * @param  SupportCollection<int, EditionPassage>  $window
     * @return WindowContext
     */
    private function windowContext(SupportCollection $window, Edition $edition): array
    {
        $passageIds = $window->pluck('canonical_passage_id')->all();

        $lemmas = Lemma::whereIn('canonical_passage_id', $passageIds)
            ->orderBy('position')
            ->with([
                'readings.transcriptionLayer:id,transcription_id,text',
                'readings.transcriptionLayer.transcription.witness:id,siglum',
                'readings.conjecture.user:id,name',
                'readings.conjecture.references.item',
            ])
            ->get();

        return [
            'passage_references' => BibliographyReference::where('edition_id', $edition->id)
                ->whereIn('canonical_passage_id', $passageIds)
                ->with('item')
                ->orderBy('position')
                ->get()
                ->toBase()
                ->groupBy('canonical_passage_id'),
            'comments' => EditionComment::where('edition_id', $edition->id)
                ->whereIn('canonical_passage_id', $passageIds)
                ->with('user:id,name')
                ->orderBy('id')
                ->get()
                ->toBase()
                ->groupBy('canonical_passage_id'),
            'unplaced' => Conjecture::whereIn('canonical_passage_id', $passageIds)
                ->whereIn('type', [ConjectureType::Substitution, ConjectureType::Deletion, ConjectureType::Lacuna, ConjectureType::Supplement])
                ->whereDoesntHave('lemmaReadings')
                ->with(['user:id,name', 'references.item'])
                ->orderBy('id')
                ->get()
                ->toBase()
                ->groupBy('canonical_passage_id'),
            'lemmas' => $lemmas->toBase()->groupBy('canonical_passage_id'),
            'selections' => EditionLemma::where('edition_id', $edition->id)
                ->whereIn('lemma_id', $lemmas->pluck('id'))
                ->with('selectedReading')
                ->get()
                ->keyBy('lemma_id'),
            'breaks' => EditionLineBreak::where('edition_id', $edition->id)
                ->whereIn('canonical_passage_id', $passageIds)
                ->get()
                ->keyBy('lemma_id'),
            // The rows of every line printed in pieces, all parts — the
            // ones on this page need their siblings to find their words.
            'parts' => EditionPassage::where('edition_id', $edition->id)
                ->whereIn('canonical_passage_id', $passageIds)
                ->orderBy('part')
                ->get(['id', 'canonical_passage_id', 'part', 'part_text'])
                ->toBase()
                ->groupBy('canonical_passage_id')
                ->filter(fn (SupportCollection $rows) => $rows->count() > 1),
        ];
    }

    /**
     * Which of the passage's runs this row prints. A whole passage prints
     * them all; a passage printed in pieces (see EditionPassage::$part)
     * has its parts' words matched, in the passage's own order, against
     * the runs' printed text. Words that no longer match — the printed
     * text changed since the arrangement was adopted — leave the division
     * stale: part 1 then prints the whole passage and the other parts
     * nothing, and the page says so.
     *
     * @param  SupportCollection<int, EditionPassage>|null  $parts
     * @param  list<array<string, mixed>>  $runs
     * @return array{parts: int, start: int, end: int, stale: bool}
     */
    private function partRange(EditionPassage $editionPassage, array $runs, ?SupportCollection $parts): array
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
            return $editionPassage->part === 1
                ? $whole + ['parts' => $parts->count(), 'stale' => true]
                : ['parts' => $parts->count(), 'start' => 0, 'end' => -1, 'stale' => true];
        }

        return ['parts' => $parts->count(), 'stale' => false] + ($ranges[$editionPassage->part] ?? ['start' => 0, 'end' => -1]);
    }

    /**
     * @param  array<string, mixed>|null  $orderRange
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomaticLayers  each transcription's diplomatic layer, keyed by transcription id
     * @param  array<int, array{siglum: string, conjecture_id: int|null, matches_current: bool, parts: array<int, array{part: int, after_label: string|null}>, statements: list<string>}>  $discontinuousWitnesses
     * @param  WindowContext  $context
     * @return array<string, mixed>
     */
    private function passageDetail(EditionPassage $editionPassage, Edition $edition, ?array $orderRange, SupportCollection $diplomaticLayers, Tokenization $tokenization, array $discontinuousWitnesses, array $context, ?int $previousEditionPassageId): array
    {
        $passage = $editionPassage->canonicalPassage;
        $base = $editionPassage->transcriptionLayer;
        $runs = $this->materializedRuns($passage, $base, $diplomaticLayers, $tokenization, $context);
        $division = $this->partRange($editionPassage, array_values($runs), $context['parts']->get($passage->id));

        return [
            'id' => $passage->id,
            'edition_passage_id' => $editionPassage->id,
            'previous_edition_passage_id' => $previousEditionPassageId,
            'label' => $passage->label,
            // Which piece of the passage this row prints — a whole passage
            // is part 1 of 1 over all its runs; see EditionPassage::$part.
            'part' => $editionPassage->part,
            'parts' => $division['parts'],
            'run_start' => $division['start'],
            'run_end' => $division['end'],
            'division_stale' => $division['stale'],
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
            'runs' => $runs,
            // The chosen witness's own line as the manuscript has it.
            'base_diplomatic' => $base !== null
                ? DiplomaticCounterpart::forPassage($passage, $diplomaticLayers->get($base->transcription_id))
                : null,
            // This edition's own notes here — see EditionComment. An
            // unanchored one (lemma_id null) is about the whole passage.
            'comments' => ($context['comments'][$passage->id] ?? collect())
                ->map(fn (EditionComment $comment) => [
                    'id' => $comment->id,
                    'lemma_id' => $comment->lemma_id,
                    'range_end_lemma_id' => $comment->range_end_lemma_id,
                    'note' => $comment->note,
                    'author' => $comment->user->name,
                ])->values(),
            'unplacedConjectures' => ($context['unplaced'][$passage->id] ?? collect())
                ->map(fn (Conjecture $conjecture) => [
                    'id' => $conjecture->id,
                    'type' => $conjecture->type->value,
                    'supplements_conjecture_id' => $conjecture->supplements_conjecture_id,
                    'label' => $this->conjectureLabel($conjecture),
                    'text' => $this->conjectureDisplayText($conjecture),
                    'note' => $conjecture->note,
                    'references' => $this->citations($conjecture->references),
                ])->values(),
            // The literature this edition cites on the passage as a whole
            // — see BibliographyReference.
            'references' => $this->citations($context['passage_references'][$passage->id] ?? collect()),
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
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomaticLayers  each transcription's diplomatic layer, keyed by transcription id
     * @param  WindowContext  $context
     * @return array<int, array<string, mixed>>
     */
    private function materializedRuns(CanonicalPassage $passage, ?TranscriptionLayer $base, SupportCollection $diplomaticLayers, Tokenization $tokenization, array $context): array
    {
        $lemmas = ($context['lemmas'][$passage->id] ?? collect())->values();
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
            // does. The base's *omission* of a run of columns (see
            // LemmaReading::$omitted) is jumped the same way, so what it
            // lacks prints as one gap rather than one per column.
            $baseReading = $this->baseReadingOf($lemma, $base);
            $baseSpan = $baseReading ?? $this->baseOmissionOf($lemma, $base);
            $baseRangeEnd = $baseSpan?->range_end_lemma_id !== null
                ? $byId->get($baseSpan->range_end_lemma_id)
                : null;

            $runs[] = $this->materializedSingleRun($lemma, $selection, $base, $lastBaseEnd, $byId, $passage, $diplomaticLayers, $tokenization, $baseRangeEnd);
            $lastBaseEnd = $baseReading->end_offset ?? $lastBaseEnd;

            $coveredUntil = $baseRangeEnd !== null
                ? $lemmas->search(fn (Lemma $candidate) => $candidate->id === $baseRangeEnd->id)
                : false;

            $index = $coveredUntil !== false ? $coveredUntil + 1 : $index + 1;
        }

        return $this->withBreaks($runs, $lemmas, $context['breaks']);
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
        // Nothing printed here on purpose — the base lacks the words, or an
        // omission/deletion was adopted — as opposed to nothing printed
        // because nothing exists yet (a conjecture-only column).
        $omitted = $isGap || ($selectedCandidate['omitted'] ?? false);

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
     * conjecture, or a witness's own reading PassageAligner determined
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
     * witness first touched the passage.
     *
     * @param  SupportCollection<int, Lemma>  $byId
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomaticLayers  each transcription's diplomatic layer, keyed by transcription id
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
     * `omitted` marks a candidate that prints nothing if picked: a witness's
     * omission of these columns (LemmaReading::$omitted) or a deletion
     * conjecture. Its `text` is empty — the client says "omitted" or
     * "deleted" in words.
     *
     * @param  SupportCollection<int, Lemma>  $byId
     * @param  SupportCollection<int, TranscriptionLayer>  $diplomaticLayers  each transcription's diplomatic layer, keyed by transcription id
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
                'text' => $extension['text'] ?? mb_substr($reading->transcriptionLayer->text, $reading->start_offset, $reading->end_offset - $reading->start_offset),
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
            'text' => mb_substr($reading->transcriptionLayer->text, $reading->start_offset, $endReading->end_offset - $reading->start_offset),
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
