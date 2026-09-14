<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateTranscriptionTextRequest;
use App\Models\Assignment;
use App\Models\EditionLemma;
use App\Models\EditionSegment;
use App\Models\LemmaReading;
use App\Models\Segment;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionPageBreak;
use App\Models\TranscriptionRegion;
use App\Support\Edition\SegmentAligner;
use App\Support\Transcription\AssignmentIntegrity;
use App\Support\Transcription\LayerMirror;
use App\Support\Transcription\RelocationAssignmentEffects;
use App\Support\Transcription\SiblingSync;
use App\Support\Transcription\SpanTransformer;
use App\Support\Transcription\TextOpApplier;
use App\Support\Transcription\WordDivision;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Collection as SupportCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class TranscriptionTextController extends Controller
{
    /**
     * Apply an ordered log of exact edit operations to a transcription's text,
     * transforming every assignment span, image-alignment region, collation
     * reading and page break's offsets deterministically in the same pass —
     * see SpanTransformer for how.
     *
     * The server never trusts the client's own offsets or resulting text
     * directly: it independently replays `ops` against its own stored text
     * and rejects the request if that doesn't match what the client
     * submitted (most likely a concurrent edit by another editor — an
     * owner and her invited editors share a transcription with no
     * per-author lock).
     */
    public function update(UpdateTranscriptionTextRequest $request, TranscriptionLayer $transcription): RedirectResponse
    {
        $affectedEditions = DB::transaction(function () use ($request, $transcription): array {
            // Two editors saving at once: the replay check below is only
            // sound against a text nobody else is changing in the same
            // moment. Writing the transcript row FIRST takes its row lock on
            // MySQL/Postgres and the database write lock on SQLite (where
            // lockForUpdate is a no-op), so a second save waits here, reads
            // the fresh text behind it, and is told its base is stale
            // instead of silently overwriting the first. One row for both
            // layers, so mirrored saves into each other's layer cannot
            // deadlock.
            Transcription::whereKey($transcription->transcription_id)->update(['updated_at' => now()]);
            $transcription->refresh();
            $original = $transcription->text;
            $ops = $this->normalizeOps($request->validated('ops'), $original);
            $recomputedText = TextOpApplier::applyAll($original, $ops);
            $submittedText = $request->validated('text') ?? '';

            if ($recomputedText !== $submittedText) {
                // Keyed 'ops', not 'text': the client tells a stale op log (a
                // concurrent edit — unrecoverable, stop autosaving and offer a
                // reload) apart from a 'text' validation failure (transiently
                // invalid markup mid-typing — keep the ops and retry).
                throw ValidationException::withMessages([
                    'ops' => 'This transcription changed since you started editing — reload and try again.',
                ]);
            }

            $lostParts = $this->applySpans($transcription->assignments, $ops, $recomputedText, $original);
            $this->applySpans($transcription->regions, $ops, $recomputedText, $original);
            $this->applyPageBreaks($transcription, $ops, $recomputedText);
            $readingOutcome = $this->applyReadings($transcription, $ops, $recomputedText);
            $affected = $readingOutcome['editions'];

            $transcription->update(['text' => $recomputedText]);
            $this->realignDamaged($transcription, $readingOutcome['realign']);
            $this->recollateLostParts($transcription, $lostParts);
            $affected = [...$affected, ...$this->collateNewWords($transcription, $ops)];

            // The editor can switch mirroring off (bootstrapping each
            // layer from a different source); the sibling is then left
            // entirely alone, refusal notice included.
            if ($request->boolean('mirror', true)) {
                $this->mirrorRelocations($transcription, $original, $ops, $affected);
            }

            // Whenever this save leaves the layers in step, one-sided spans
            // get their counterparts — a span assigned while the layers
            // were apart heals here (see SiblingSync::heal).
            SiblingSync::heal($transcription->refresh());

            // Whatever this save did to the spans, none may have left its
            // words: a drifted assignment is trimmed of whitespace and, if it
            // still begins or ends inside a word, flagged for review — and
            // the ops that did it are logged, so the cause can be found.
            foreach ($transcription->transcription->layers()->get() as $layer) {
                $drift = AssignmentIntegrity::snap($layer);

                if ($drift !== []) {
                    Log::warning('Assignment spans drifted off their words after a text save', [
                        'layer' => $layer->id,
                        'edited_layer' => $transcription->id,
                        'ops' => $ops,
                        'issues' => $drift,
                    ]);
                }
            }

            return $affected;
        });

        // Nothing is said about what the mirror did or declined to do (user
        // decision): both panes are on screen, so the editor watches it
        // happen, and a line of prose after every save was noise. Where the
        // layers are out of step the indicator by the layer buttons still
        // says so, standing until it is true no longer.
        $notices = [];

        if ($affectedEditions !== []) {
            $notices[] = $this->editionReport(array_values(array_unique($affectedEditions)));
        }

        if ($notices !== []) {
            session()->flash('message', implode(' ', $notices));
            // The notice belongs to the pane whose save produced it — the
            // sibling pane showing it too read as a report about ITS OWN
            // layer (real confusion: a paste's import notice appeared over
            // both panes).
            session()->flash('message_layer_id', $transcription->id);
        }

        return back();
    }

    /**
     * Replay this save's relocations on the sibling layer, so moving text
     * around in one layer moves the corresponding text in the other — the
     * two layers share a word skeleton (see LayerCorrespondence), and a
     * whole-word move means the same thing in either spelling.
     *
     * The mirrored ops run through the very same span pipeline, so the
     * sibling's assignment assignments, image regions and collation readings
     * travel exactly as this layer's did. Page breaks are deliberately NOT
     * reapplied: they live on the transcription in line coordinates, shared
     * by both layers, and this layer's pass already moved them — a second
     * pass would move them twice.
     *
     * @param  list<array{start: int, end: int, text: string, cut_id: string|null, atomic?: bool, mirror_text?: string|null}>  $ops
     * @param  list<string>  $affected  edition titles, appended to in place
     */
    private function mirrorRelocations(TranscriptionLayer $transcription, string $originalText, array $ops, array &$affected): void
    {
        $sibling = $transcription->transcription->layers()
            ->whereKeyNot($transcription->id)
            ->first();

        // An EMPTY sibling is not excluded: importing or pasting into one
        // layer of a fresh pair is exactly how the other gets its words
        // (two empty texts are trivially in step). LayerMirror's own
        // in-step check governs every other case.
        if ($sibling === null) {
            return;
        }

        // Read before the mirrored ops are applied: what the sibling's own
        // spans are transformed against, and what says where its words are.
        $siblingBefore = $sibling->text;

        $mirror = LayerMirror::mirror($originalText, $ops, $siblingBefore);

        // A mirror LayerMirror declines — the layers out of step, or their
        // words no longer corresponding around the edit — leaves the sibling
        // alone and says nothing. The editor can see both panes, and the
        // out-of-step indicator by the layer buttons is the standing signal.
        if ($mirror === null) {
            return;
        }

        $siblingLostParts = $this->applySpans($sibling->assignments, $mirror['ops'], $mirror['text'], $siblingBefore);
        $this->applySpans($sibling->regions, $mirror['ops'], $mirror['text'], $siblingBefore);
        $siblingOutcome = $this->applyReadings($sibling, $mirror['ops'], $mirror['text']);
        $affected = [...$affected, ...$siblingOutcome['editions']];

        $sibling->update(['text' => $mirror['text']]);
        $this->realignDamaged($sibling, $siblingOutcome['realign']);
        $this->recollateLostParts($sibling, $siblingLostParts);
        $affected = [...$affected, ...$this->collateNewWords($sibling, $mirror['ops'])];
    }

    /**
     * Normalize the raw op payload — and verify every cut/paste claim before
     * SpanTransformer honours it. A `cut_id` pairing one deletion with one
     * later insertion of *exactly* the deleted text makes spans inside the
     * cut travel with it (see SpanTransformer); the deleted text is
     * recomputed here by replaying the log against the stored text, so a
     * client cannot pair unrelated ops and teleport an assignment onto words it
     * never covered. A malformed claim keeps its op but loses the id,
     * degrading to an ordinary edit (which deletes rather than carries).
     * A cut whose paste hasn't arrived in this save keeps its id — the
     * transformer degrades it to a deletion by itself.
     *
     * @param  list<array{start: mixed, end: mixed, text: mixed, cut_id?: mixed, atomic?: mixed, mirror_text?: mixed, side?: mixed, imported?: mixed}>  $ops
     * @return list<array{start: int, end: int, text: string, cut_id: string|null, atomic: bool, mirror_text: string|null, side: string|null, imported: bool}>
     */
    private function normalizeOps(array $ops, string $originalText): array
    {
        $normalized = array_map(fn (array $op) => [
            'start' => (int) $op['start'],
            'end' => (int) $op['end'],
            'text' => $op['text'] ?? '',
            'cut_id' => isset($op['cut_id']) && is_string($op['cut_id']) ? $op['cut_id'] : null,
            // Marked by the client for paste/import/undo/strip and
            // selection-wide deletions — the whole-word edits the sibling
            // layer mirrors verbatim. Typing is never atomic: the first
            // keystroke of a spelling change must stay in its own layer.
            'atomic' => (bool) ($op['atomic'] ?? false),
            // What the sibling should receive where this op's text would
            // otherwise be replayed verbatim — an undo restoring the
            // sibling's own former spelling. See LayerMirror.
            'mirror_text' => isset($op['mirror_text']) && is_string($op['mirror_text']) ? $op['mirror_text'] : null,
            // Which side of a marker the caret stood on, where it stood at
            // one. The offset is the same on both sides; this is what tells
            // them apart. See SpanTransformer::claimant.
            'side' => in_array($op['side'] ?? null, ['before', 'after'], true) ? $op['side'] : null,
            // Arrived rather than typed: it stays unassigned where typing
            // would have been made to assign. See SpanTransformer::claimant.
            'imported' => (bool) ($op['imported'] ?? false),
        ], $ops);

        $running = $originalText;
        $cutTexts = [];
        $pasted = [];

        foreach ($normalized as $index => $op) {
            // A line-break edit mirrors even as a single keystroke: Enter is
            // never the first character of a spelling change, and the line
            // structure is the SHARED part of the skeleton (page breaks live
            // in it). Whitespace-only, with a newline on either side of the
            // change.
            if (! $normalized[$index]['atomic']) {
                $removed = mb_substr($running, $op['start'], $op['end'] - $op['start']);

                $normalized[$index]['atomic'] = preg_match('/^\s*$/u', $op['text']) === 1
                    && preg_match('/^\s*$/u', $removed) === 1
                    && (str_contains($op['text'], "\n") || str_contains($removed, "\n"));
            }

            if ($op['cut_id'] !== null) {
                $isCut = $op['text'] === '' && $op['end'] > $op['start'] && ! array_key_exists($op['cut_id'], $cutTexts);
                $isPaste = $op['text'] !== '' && $op['start'] === $op['end']
                    && array_key_exists($op['cut_id'], $cutTexts)
                    && ! isset($pasted[$op['cut_id']])
                    && $cutTexts[$op['cut_id']] === $op['text'];

                if ($isCut) {
                    $cutTexts[$op['cut_id']] = mb_substr($running, $op['start'], $op['end'] - $op['start']);
                } elseif ($isPaste) {
                    $pasted[$op['cut_id']] = true;
                } else {
                    $normalized[$index]['cut_id'] = $this->adoptOutstandingCut($op, $cutTexts, $pasted);

                    if ($normalized[$index]['cut_id'] !== null) {
                        $pasted[$normalized[$index]['cut_id']] = true;
                    }
                }
            }

            $running = TextOpApplier::apply($running, $normalized[$index]);
        }

        return $normalized;
    }

    /**
     * An insert that CLAIMS relocation under an id no cut in this request
     * recorded is, in practice, the undo of a lone cut whose id was minted
     * apart from its half (a client bug now fixed — but logs it saved still
     * arrive). Both halves declared relocation intent, so when an
     * outstanding cut removed exactly these characters the intent is
     * unambiguous: re-pair them by content rather than delete the very
     * assignments the undo was restoring.
     *
     * @param  array{start: int, end: int, text: string}  $op
     * @param  array<string, string>  $cutTexts
     * @param  array<string, true>  $pasted
     */
    private function adoptOutstandingCut(array $op, array $cutTexts, array $pasted): ?string
    {
        if ($op['text'] === '' || $op['start'] !== $op['end']) {
            return null;
        }

        foreach ($cutTexts as $cutId => $cutText) {
            if (! isset($pasted[$cutId]) && $cutText === $op['text']) {
                return $cutId;
            }
        }

        return null;
    }

    /**
     * Keep the transcription's page divisions where they belong when its text
     * changes.
     *
     * A division is a line number shared by both layers, so it does not shift
     * when characters change within a line — only when the edit adds or
     * removes whole lines before it. Rather than reason about that directly,
     * each break is resolved to this layer's offset, moved with the same
     * machinery as everything else, and read back as a line.
     *
     * Points, not spans: `transformPoints` keeps an insertion made exactly at
     * a break *after* it, so the first words typed at the top of a page belong
     * to that page. A break is never deleted — emptying a page does not
     * abolish it.
     *
     * @param  list<array{start: int, end: int, text: string}>  $ops
     */
    private function applyPageBreaks(TranscriptionLayer $transcription, array $ops, string $newText): void
    {
        $breaks = $transcription->transcription->pageBreaks()->orderBy('start_line')->get();

        if ($breaks->isEmpty()) {
            return;
        }

        $moved = SpanTransformer::transformPoints(
            array_values($breaks->map(
                fn (TranscriptionPageBreak $break) => $transcription->offsetOfLine($break->start_line)
            )->all()),
            $ops,
        );

        $after = $transcription->replicate()->forceFill(['text' => $newText]);

        foreach ($breaks as $index => $break) {
            $line = $after->lineOfOffset($moved[$index]);

            if ($line !== (int) $break->start_line) {
                $break->update(['start_line' => $line]);
            }
        }
    }

    /**
     * @param  Collection<int, Assignment>|Collection<int, TranscriptionRegion>  $spans
     * @param  list<array{start: int, end: int, text: string, cut_id?: string|null}>  $ops
     * @return list<int> segment ids that lost an assigned part (assignments only)
     */
    private function applySpans(Collection $spans, array $ops, ?string $newText = null, ?string $textBefore = null): array
    {
        $spans = $spans->values();

        $transformed = SpanTransformer::transform(
            array_values($spans->map(fn ($span) => [
                'start' => (int) $span->start_offset,
                'end' => (int) $span->end_offset,
                'needsReview' => (bool) $span->needs_review,
            ])->all()),
            $ops,
            // Only assignments claim what is typed against them; a region or a
            // reading is pushed along instead.
            $spans->first() instanceof Assignment,
            $textBefore,
        );

        // A relocation's assignment consequences beyond offset moves: a cut
        // FRAGMENT of an assigned span becomes a new part of its own segment at
        // the paste site, and a span the paste lands inside SPLITS around
        // the arrival instead of absorbing it. Assignments only — see
        // RelocationAssignmentEffects.
        $effects = $spans->first() instanceof Assignment
            ? RelocationAssignmentEffects::plan(
                $spans->whereInstanceOf(Assignment::class)->values(),
                $ops,
                $textBefore,
            )
            : ['overrides' => [], 'unflag' => [], 'creates' => []];

        $lostPartSegments = [];

        foreach ($spans as $index => $span) {
            $result = $transformed[$index];

            if (isset($effects['overrides'][$index])) {
                $override = $effects['overrides'][$index];
                $span->update([
                    'start_offset' => $override['start'],
                    'end_offset' => $override['end'],
                    'needs_review' => $override['needsReview'],
                ]);

                continue;
            }

            if ($result['deleted']) {
                // The manuscript no longer carries these words, so the
                // assignment goes with them: an assignment without text is
                // nothing (user decision, reversing an earlier policy that
                // kept a zero-width flagged marker — it preserved the
                // assignment but never restored it, and read as clutter).
                // What protects the editor instead: cut/paste pairs carry
                // spans whole, and undoing a destructive edit restores the
                // rows along
                // with the text — the client's history snapshots what an op
                // destroyed and re-creates it (assignments
                // restore endpoint). A destroyed PART still flags its
                // surviving sibling parts below, since the segment's
                // witness text just lost a piece.
                if ($span instanceof Assignment) {
                    $lostPartSegments[$span->segment_id] = true;
                }

                $span->delete();

                continue;
            }

            $attributes = [
                'start_offset' => $result['start'],
                'end_offset' => $result['end'],
                'needs_review' => in_array($index, $effects['unflag'], true)
                    ? false
                    : $result['needsReview'],
            ];

            if ($newText !== null && $span instanceof TranscriptionRegion) {
                $attributes['text'] = mb_substr($newText, $result['start'], $result['end'] - $result['start']);
            }

            $span->update($attributes);
        }

        // Rows the relocation calls into being: cut fragments carrying
        // their source's assignment, and the right halves of split targets —
        // each placed in its segment's part order next to the span it came
        // from (see Assignment::$part).
        foreach ($effects['creates'] as $create) {
            /** @var Assignment $anchor */
            $anchor = $spans[$create['anchor_index']];
            $anchor->refresh();

            $siblings = Assignment::where('transcription_layer_id', $anchor->transcription_layer_id)
                ->where('segment_id', $create['segment_id']);

            if ($create['placement'] === 'before') {
                $newPart = $anchor->part;
                $siblings->clone()->where('part', '>=', $newPart)->increment('part');
            } else {
                $newPart = $anchor->part + 1;
                $siblings->clone()->where('part', '>', $anchor->part)->increment('part');
            }

            Assignment::create([
                'transcription_layer_id' => $anchor->transcription_layer_id,
                'segment_id' => $create['segment_id'],
                'start_offset' => $create['start'],
                'end_offset' => $create['end'],
                'part' => $newPart,
                // Its own identity; the healing pass gives it a counterpart.
                'group_id' => (string) Str::uuid(),
            ]);
        }

        if ($spans->first() instanceof Assignment && $newText !== null) {
            $this->mergeRejoinedParts($spans->first()->transcriptionLayer, $newText);
        }

        // A destroyed assignment may have been one *part* of a segment assigned
        // by several spans — the segment's witness text lost a piece, so
        // its collation for this layer may be stale. That is the CALLER's
        // to resolve once the new text is saved (see recollateLostParts):
        // re-derive where a collation exists, flag only where re-derivation
        // is refused, do nothing where the layer was never collated —
        // blind-flagging the survivors here was noise (real incident: a
        // rearranged, never-collated line arrived flagged in both layers).
        return array_keys($lostPartSegments);
    }

    /**
     * Collapse two parts of one segment that have REJOINED into one row: they
     * stand next to each other in the text with nothing but whitespace
     * between, AND read next to each other as content — the later one is the
     * earlier one's successor in part order. A relocation that cut a
     * fragment out of a span created a separate part for it; UNDOING that
     * relocation carries the fragment back — the text rejoins, and so must
     * the rows, or every move-and-undo leaves duplicate assignments behind
     * (real incident: one line 4, three rows, a badge saying 2/3).
     *
     * Content order is the half that matters. Two halves of a line that a
     * scribe SWAPPED also stand a space apart, and fusing them would erase
     * the transposition — which an earlier version did on the next
     * unrelated keystroke (real bug). Parts 2 and 1 in that physical order
     * are not rejoined text; parts 1 and 2 are.
     *
     * Whitespace between them is no division: an assignment owns none at its
     * edges (AssignmentBounds), so two parts that read continuously stand a
     * space apart rather than flush.
     */
    private function mergeRejoinedParts(TranscriptionLayer $transcription, string $text): void
    {
        $bySegment = $transcription->assignments()
            ->orderBy('start_offset')
            ->get()
            ->groupBy('segment_id');

        foreach ($bySegment as $rows) {
            // Who follows whom as CONTENT: each part's successor in part
            // order, by id — a merge inherits the merged part's successor.
            $inPartOrder = Assignment::sortByPartOrder($rows);
            $successor = [];

            foreach ($inPartOrder as $index => $part) {
                $successor[$part->id] = $inPartOrder[$index + 1]->id ?? null;
            }

            /** @var Assignment|null $kept */
            $kept = null;

            foreach ($rows as $row) {
                $between = $kept === null ? '' : mb_substr(
                    $text,
                    (int) $kept->end_offset,
                    max(0, (int) $row->start_offset - (int) $kept->end_offset),
                );

                if ($kept !== null
                    && $successor[$kept->id] === $row->id
                    && preg_match('/^\s*$/u', $between) === 1) {
                    $kept->update([
                        'start_offset' => min((int) $kept->start_offset, (int) $row->start_offset),
                        'end_offset' => max((int) $kept->end_offset, (int) $row->end_offset),
                        'needs_review' => $kept->needs_review || $row->needs_review,
                    ]);
                    $successor[$kept->id] = $successor[$row->id];
                    $row->delete();

                    continue;
                }

                $kept = $row;
            }
        }
    }

    /**
     * Collation readings carry offsets into this same text, so they transform
     * exactly like assignments and regions.
     *
     * Nothing here needs the editor's permission. An edit to a witness only
     * reaches a reader when that witness is the reading some edition prints:
     * where the edition prints a different manuscript, or a conjecture, the
     * apparatus simply reports the witness's new wording and the printed text
     * is untouched. So this acts, and `update()` reports afterwards on the one
     * case an editor cannot see coming — that her correction also changed an
     * edition's own printed words.
     *
     * What the edit damaged is handled by whether anything selected it
     * (user decision, narrowing needs_review to selected readings only). An
     * UNSELECTED reading the edit destroyed or left with guessed boundaries
     * is deleted and its segment queued for re-collation — a reading is
     * machine-re-derivable, so a human flag would only be noise (the caller
     * runs the realign after the new text is saved, since collation reads
     * it). A SELECTED reading is the one thing the machine must not touch:
     * destroyed, it is kept as a zero-width flagged span, since
     * edition_lemmas.selected_reading_id is NOT NULL and cascades —
     * deleting would discard that edition's decision rather than merely
     * emptying it; damaged, it is flagged for the editor to confirm or
     * re-choose (re-picking it in the variant panel clears the flag).
     *
     * @param  list<array{start: int, end: int, text: string}>  $ops
     * @return array{editions: list<string>, realign: list<int>} edition titles whose printed wording changed, and segment ids whose collation of this layer needs re-deriving
     */
    private function applyReadings(TranscriptionLayer $transcription, array $ops, string $newText): array
    {
        $readings = $transcription->lemmaReadings()
            ->whereNotNull('start_offset')
            ->whereNotNull('end_offset')
            ->get()
            ->values();

        if ($readings->isEmpty()) {
            return ['editions' => [], 'realign' => []];
        }

        $transformed = SpanTransformer::transform(
            array_values($readings->map(fn (LemmaReading $reading) => [
                'start' => (int) $reading->start_offset,
                'end' => (int) $reading->end_offset,
                'needsReview' => (bool) $reading->needs_review,
            ])->all()),
            $ops,
        );

        $selectingEditions = $this->selectingEditions($readings);
        $affected = [];
        $realign = [];

        foreach ($readings as $index => $reading) {
            $result = $transformed[$index];
            $selectedBy = $selectingEditions[$reading->id] ?? [];

            // An omission reading is a point, not a span of text: it moves
            // with the text around it and is never destroyed by an edit —
            // the collation that follows re-derives it if the omission
            // itself no longer holds.
            if ($reading->omitted) {
                $reading->update(['start_offset' => $result['start'], 'end_offset' => $result['start']]);

                continue;
            }

            // As words: dividing a word at a line's end changes the
            // characters, not the wording (WordDivision).
            $before = WordDivision::wordText(
                $transcription->text,
                (int) $reading->start_offset,
                (int) $reading->end_offset,
            );

            // Damaged BY THIS EDIT: destroyed, or newly left with guessed
            // boundaries. A reading flagged before this edit is not
            // re-judged here.
            $newlyDamaged = $result['deleted']
                || ($result['needsReview'] && ! $reading->needs_review);

            if ($newlyDamaged && $selectedBy === []) {
                $realign[] = (int) $reading->lemma->segment_id;
                $reading->delete();

                continue;
            }

            // A destroyed span collapses to zero width at the edit point; an
            // ordinary one keeps its transformed bounds.
            $end = $result['deleted'] ? $result['start'] : $result['end'];

            $reading->update([
                'start_offset' => $result['start'],
                'end_offset' => $end,
                'needs_review' => $result['deleted'] ? true : $result['needsReview'],
            ]);

            $after = WordDivision::wordText($newText, $result['start'], $end);

            // Only a change to the *words* is edition-visible; an edit
            // elsewhere that merely shifts this reading's offsets is not.
            if ($selectedBy !== [] && $before !== $after) {
                $affected = [...$affected, ...$selectedBy];
            }
        }

        return [
            'editions' => array_values(array_unique($affected)),
            'realign' => array_values(array_unique($realign)),
        ];
    }

    /**
     * Re-derive the collation an edit damaged, once the text it reads from
     * is saved: the deleted unselected readings come back re-collated — or
     * stay genuinely gone, where the manuscript no longer has the words.
     * realignLayer refuses where pinned readings hold the segment; those
     * are the selected/conjecture rows this pass never deletes anyway.
     *
     * @param  list<int>  $segmentIds
     */
    private function realignDamaged(TranscriptionLayer $transcription, array $segmentIds): void
    {
        foreach (array_unique($segmentIds) as $segmentId) {
            $segment = Segment::find($segmentId);

            if ($segment !== null) {
                SegmentAligner::realignLayer($segment, $transcription);
            }
        }
    }

    /**
     * A segment that lost one of its assigned parts has stale collation for
     * this layer — where a collation exists at all. Same narrowing as
     * damaged readings: re-derive rather than flag; where re-derivation is
     * refused (pinned readings hold the segment) flag the surviving parts,
     * exactly like the late-part flow
     * (AssignmentController::recollateLayer); and where the
     * layer was never collated on the segment there is nothing stale, so
     * nothing happens.
     *
     * @param  list<int>  $segmentIds
     */
    private function recollateLostParts(TranscriptionLayer $transcription, array $segmentIds): void
    {
        foreach (array_unique($segmentIds) as $segmentId) {
            $segment = Segment::find($segmentId);

            if ($segment === null || SegmentAligner::layerReadings($segment, $transcription)->isEmpty()) {
                continue;
            }

            if (! SegmentAligner::realignLayer($segment, $transcription)) {
                $transcription->assignments()
                    ->where('segment_id', $segment->id)
                    ->update(['needs_review' => true]);
            }
        }
    }

    /**
     * A word typed into a collated witness enters its collation — the one
     * kind of edit the passes above do not reach: an insertion between two
     * words damages no reading, so nothing re-derived the segment and the
     * new word was invisible to every edition and apparatus (real defect,
     * 2026-09-14). For every collated segment the edit touched whose text
     * now holds words the layer's readings do not cover, the collation
     * GROWS around what it has (SegmentAligner::growLayer) — never a
     * rebuild: a rebuild re-diffs the whole line and can fold the new word
     * and its neighbour into one substitution against the column an
     * edition chose from, discarding the reading the editor decided
     * against (seen in testing), and it replaces readings the editor's
     * choices and the apparatus hold by id. Runs after the new text is
     * saved, since collation reads it.
     *
     * @param  list<array{start: int, end: int, text: string}>  $ops
     * @return list<string> the titles of editions whose printed text is this layer here — they gained the words
     */
    private function collateNewWords(TranscriptionLayer $transcription, array $ops): array
    {
        if ($ops === []) {
            return [];
        }

        // The stretch of the new text the ops could have reached, generously:
        // from the first edit to the last, plus everything typed.
        $from = min(array_column($ops, 'start'));
        $to = max(array_column($ops, 'end')) + array_sum(array_map(fn (array $op) => mb_strlen($op['text']), $ops));
        $affected = [];

        $segmentIds = Assignment::where('transcription_layer_id', $transcription->id)
            ->where('start_offset', '<=', $to)
            ->where('end_offset', '>=', $from)
            ->pluck('segment_id')
            ->unique();

        foreach ($segmentIds as $segmentId) {
            $segment = Segment::whereKey($segmentId)->first();

            if ($segment === null
                || SegmentAligner::layerReadings($segment, $transcription)->isEmpty()
                || ! SegmentAligner::hasUncollatedWords($segment, $transcription)) {
                continue;
            }

            SegmentAligner::growLayer($segment, $transcription);

            $affected = [
                ...$affected,
                ...EditionSegment::where('segment_id', $segment->id)
                    ->where('transcription_layer_id', $transcription->id)
                    ->with('edition:id,title')
                    ->get()
                    ->map(fn (EditionSegment $editionSegment) => (string) $editionSegment->edition->title)
                    ->all(),
            ];
        }

        return array_values(array_unique($affected));
    }

    /**
     * Edition titles keyed by the id of the reading they print, for just
     * these readings — the one thing that decides whether an edit to a
     * witness is visible to a reader at all.
     *
     * @param  SupportCollection<int, LemmaReading>  $readings
     * @return array<int, list<string>>
     */
    private function selectingEditions(SupportCollection $readings): array
    {
        return EditionLemma::query()
            ->whereIn('selected_reading_id', $readings->map(fn (LemmaReading $reading): int => $reading->id)->all())
            ->with('edition:id,title')
            ->get()
            ->groupBy('selected_reading_id')
            ->map(fn (SupportCollection $selections) => array_values(array_unique(
                $selections->map(fn (EditionLemma $selection): string => $selection->edition->title)->all()
            )))
            ->all();
    }

    /**
     * @param  list<string>  $titles
     */
    private function editionReport(array $titles): string
    {
        $subject = count($titles) === 1
            ? 'the edition “'.$titles[0].'”'
            : 'the editions '.collect($titles)->map(fn (string $title) => '“'.$title.'”')->join(', ', ' and ');

        return 'This also changed the printed wording of '.$subject.', which prints these words.';
    }
}
