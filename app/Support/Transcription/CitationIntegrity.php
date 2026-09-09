<?php

namespace App\Support\Transcription;

use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use Illuminate\Support\Collection;

/**
 * Whether a layer's citation spans still sit where citations can sit:
 * on whole words, never beginning or ending inside one, never
 * overlapping one another. Spans are offsets into the text and every
 * edit transforms them, so a span that has drifted off its words is the
 * one symptom every offset bug has in common — this is the check that
 * catches drift early, whatever caused it (a real incident: one witness's
 * spans had slid a character, then a word, and its number tags stood at
 * the ends of the preceding lines).
 */
class CitationIntegrity
{
    /**
     * Every complaint about the layer, in reading order; empty when clean.
     * Whitespace at a span's edges is not one: a drag over a whole line
     * routinely takes its line break along, and citations have always
     * been allowed that. What is never right is a span that begins or
     * ends INSIDE a word (unless another citation meets it exactly there —
     * two lines pasted flush together — or the neighbour is inside another
     * citation), or one that overlaps another.
     *
     * @return list<string>
     */
    public static function issues(TranscriptionLayer $layer): array
    {
        $issues = [];

        foreach (self::assess($layer) as [$segment, $problems]) {
            foreach ($problems as $problem) {
                $issues[] = self::label($segment).' '.$problem;
            }
        }

        return $issues;
    }

    /**
     * Hold the line after a save: every span that has slipped off its
     * words carries `boundary_review` from now on, and loses it again the
     * moment its bounds are right — so the editor sees a red tag with an
     * explanation, never a tag standing in the wrong place, and never a
     * flag she has to clear by hand (user decision: no state without the
     * editor's doing, and none she has to wonder about). Offsets are never
     * touched here. Returns what changed.
     *
     * @return list<string>
     */
    public static function snap(TranscriptionLayer $layer): array
    {
        $found = [];

        foreach (self::assess($layer) as [$segment, $problems]) {
            $drifted = $problems !== [];

            if ($drifted === (bool) $segment->boundary_review) {
                continue;
            }

            $segment->update(['boundary_review' => $drifted]);
            $found[] = self::label($segment).($drifted
                ? ' flagged: '.implode('; ', $problems)
                : ' back on its words — flag cleared');
        }

        return $found;
    }

    /**
     * Each live span with its problems (possibly none).
     *
     * @return list<array{0: TranscriptionSegment, 1: list<string>}>
     */
    private static function assess(TranscriptionLayer $layer): array
    {
        $text = $layer->text;
        $length = mb_strlen($text);
        $segments = $layer->segments()->with('canonicalPassage:id,label')->orderBy('start_offset')->get()->values();
        $isSpace = fn (string $char): bool => $char === '' || preg_match('/\\s/u', $char) === 1;
        $coveredBy = fn (int $offset, TranscriptionSegment $self): bool => $segments->contains(
            fn (TranscriptionSegment $other) => $other->id !== $self->id
                && $other->end_offset > $other->start_offset
                && $offset >= $other->start_offset
                && $offset < $other->end_offset,
        );
        $meetsAt = fn (int $offset, TranscriptionSegment $self): bool => $segments->contains(
            fn (TranscriptionSegment $other) => $other->id !== $self->id
                && $other->end_offset > $other->start_offset
                && ($other->start_offset === $offset || $other->end_offset === $offset),
        );
        $result = [];

        foreach ($segments as $index => $segment) {
            $start = (int) $segment->start_offset;
            $end = (int) $segment->end_offset;
            $problems = [];

            if ($end <= $start) {
                $result[] = [$segment, []];

                continue;
            }

            // Trailing or leading whitespace inside the span is allowed;
            // judge the boundary from the first and last real characters.
            $firstReal = $start;
            while ($firstReal < $end && $isSpace(mb_substr($text, $firstReal, 1))) {
                $firstReal++;
            }
            $lastReal = $end;
            while ($lastReal > $firstReal && $isSpace(mb_substr($text, $lastReal - 1, 1))) {
                $lastReal--;
            }

            if ($firstReal < $lastReal) {
                $before = $firstReal > 0 ? mb_substr($text, $firstReal - 1, 1) : '';
                $after = $lastReal < $length ? mb_substr($text, $lastReal, 1) : '';

                if (! $isSpace($before) && ! $coveredBy($firstReal - 1, $segment) && ! $meetsAt($firstReal, $segment)) {
                    $problems[] = 'begins inside a word';
                }

                if (! $isSpace($after) && ! $coveredBy($lastReal, $segment) && ! $meetsAt($lastReal, $segment)) {
                    $problems[] = 'ends inside a word';
                }
            }

            if ($index > 0 && $start < (int) $segments[$index - 1]->end_offset) {
                $problems[] = 'overlaps '.self::label($segments[$index - 1]);
            }

            $result[] = [$segment, $problems];
        }

        return $result;
    }

    /**
     * Every layer with complaints.
     *
     * @return Collection<int, array{layer: TranscriptionLayer, issues: non-empty-list<string>}>
     */
    public static function report(): Collection
    {
        $findings = [];

        foreach (TranscriptionLayer::with(['segments.canonicalPassage', 'transcription.witness'])->get() as $layer) {
            $issues = self::issues($layer);

            if ($issues !== []) {
                $findings[$layer->id] = ['layer' => $layer, 'issues' => $issues];
            }
        }

        return collect(array_values($findings));
    }

    private static function label(TranscriptionSegment $segment): string
    {
        $part = $segment->part > 1 ? " part {$segment->part}" : '';

        return "#{$segment->id} (".($segment->canonicalPassage->label ?? '?')."$part)";
    }
}
