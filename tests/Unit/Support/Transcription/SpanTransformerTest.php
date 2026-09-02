<?php

use App\Support\Transcription\SpanTransformer;

function span(int $start, int $end, bool $needsReview = false): array
{
    return ['start' => $start, 'end' => $end, 'needsReview' => $needsReview];
}

test('an empty op log leaves every span untouched', function () {
    $result = SpanTransformer::transform([span(1, 3)], []);

    expect($result)->toBe([
        ['start' => 1, 'end' => 3, 'needsReview' => false, 'deleted' => false],
    ]);
});

test('a span entirely before a distant edit is unaffected', function () {
    $result = SpanTransformer::transform([span(0, 3)], [
        ['start' => 5, 'end' => 5, 'text' => 'XYZ'],
    ]);

    expect($result)->toBe([
        ['start' => 0, 'end' => 3, 'needsReview' => false, 'deleted' => false],
    ]);
});

test('a span entirely after a prepended insertion is shifted, not absorbed', function () {
    $result = SpanTransformer::transform([span(0, 3)], [
        ['start' => 0, 'end' => 0, 'text' => 'XYZ'],
    ]);

    expect($result)->toBe([
        ['start' => 3, 'end' => 6, 'needsReview' => false, 'deleted' => false],
    ]);
});

test('multibyte inserted text shifts a trailing span by its character count', function () {
    $result = SpanTransformer::transform([span(4, 7)], [
        ['start' => 0, 'end' => 3, 'text' => 'μῆνιν'],
    ]);

    expect($result)->toBe([
        ['start' => 6, 'end' => 9, 'needsReview' => false, 'deleted' => false],
    ]);
});

test('an interior insertion is absorbed into the span, not flagged', function () {
    $result = SpanTransformer::transform([span(4, 7)], [
        ['start' => 5, 'end' => 5, 'text' => 'X'],
    ]);

    expect($result)->toBe([
        ['start' => 4, 'end' => 8, 'needsReview' => false, 'deleted' => false],
    ]);
});

test('an interior replacement is absorbed into the span, not flagged', function () {
    $result = SpanTransformer::transform([span(4, 7)], [
        ['start' => 5, 'end' => 6, 'text' => 'XY'],
    ]);

    expect($result)->toBe([
        ['start' => 4, 'end' => 8, 'needsReview' => false, 'deleted' => false],
    ]);
});

test('a zero-width insertion exactly at a span\'s start shifts the span forward', function () {
    $result = SpanTransformer::transform([span(4, 7)], [
        ['start' => 4, 'end' => 4, 'text' => 'XYZ'],
    ]);

    expect($result)->toBe([
        ['start' => 7, 'end' => 10, 'needsReview' => false, 'deleted' => false],
    ]);
});

test('a zero-width insertion exactly at a span\'s end is absorbed', function () {
    $result = SpanTransformer::transform([span(4, 7)], [
        ['start' => 7, 'end' => 7, 'text' => 'XYZ'],
    ]);

    expect($result)->toBe([
        ['start' => 4, 'end' => 10, 'needsReview' => false, 'deleted' => false],
    ]);
});

test('two spans sharing a boundary point resolve differently for the same insertion', function () {
    $result = SpanTransformer::transform([span(4, 7), span(7, 10)], [
        ['start' => 7, 'end' => 7, 'text' => 'XYZ'],
    ]);

    expect($result)->toBe([
        ['start' => 4, 'end' => 10, 'needsReview' => false, 'deleted' => false],
        ['start' => 10, 'end' => 13, 'needsReview' => false, 'deleted' => false],
    ]);
});

test('an edit straddling a span\'s left boundary trims and shifts it, flagged', function () {
    // 'the cat sat' -> delete indices [2,5) ("e c") -> span {4,7} ("cat") loses its
    // first character to the deletion; "at" survives, now starting right after "th".
    $result = SpanTransformer::transform([span(4, 7)], [
        ['start' => 2, 'end' => 5, 'text' => ''],
    ]);

    expect($result)->toBe([
        ['start' => 2, 'end' => 4, 'needsReview' => true, 'deleted' => false],
    ]);
});

test('an edit straddling a span\'s right boundary trims it, flagged', function () {
    // 'the cat sat' -> delete indices [6,9) ("t s") -> span {4,7} ("cat") loses its
    // last character; "ca" survives in place.
    $result = SpanTransformer::transform([span(4, 7)], [
        ['start' => 6, 'end' => 9, 'text' => ''],
    ]);

    expect($result)->toBe([
        ['start' => 4, 'end' => 6, 'needsReview' => true, 'deleted' => false],
    ]);
});

test('a replacement that exactly consumes a span follows the replacement, flagged', function () {
    $result = SpanTransformer::transform([span(4, 7)], [
        ['start' => 4, 'end' => 7, 'text' => 'dog'],
    ]);

    expect($result)->toBe([
        ['start' => 4, 'end' => 7, 'needsReview' => true, 'deleted' => false],
    ]);
});

test('a replacement wider than a span still makes it follow the replacement, flagged', function () {
    $result = SpanTransformer::transform([span(4, 7)], [
        ['start' => 0, 'end' => 11, 'text' => 'replaced'],
    ]);

    expect($result)->toBe([
        ['start' => 0, 'end' => 8, 'needsReview' => true, 'deleted' => false],
    ]);
});

test('deleting exactly a span\'s own text collapses it to a flagged tombstone at the deletion point', function () {
    $result = SpanTransformer::transform([span(4, 7)], [
        ['start' => 4, 'end' => 7, 'text' => ''],
    ]);

    expect($result)->toBe([
        ['start' => 4, 'end' => 4, 'needsReview' => true, 'deleted' => true],
    ]);
});

test('a delete wider than a span also destroys it, tombstoned where the deletion began', function () {
    $result = SpanTransformer::transform([span(4, 7)], [
        ['start' => 0, 'end' => 11, 'text' => ''],
    ]);

    expect($result)->toBe([
        ['start' => 0, 'end' => 0, 'needsReview' => true, 'deleted' => true],
    ]);
});

test('a destroyed span\'s tombstone keeps transforming through later ops', function () {
    // Destroyed at 4, then "XX" prepended — the tombstone must land at 6,
    // not stay frozen at stale offsets, so the caller keeps the row at the
    // right place in the final text.
    $result = SpanTransformer::transform([span(4, 7)], [
        ['start' => 4, 'end' => 7, 'text' => ''],
        ['start' => 0, 'end' => 0, 'text' => 'XX'],
    ]);

    expect($result)->toBe([
        ['start' => 6, 'end' => 6, 'needsReview' => true, 'deleted' => true],
    ]);
});

test('a cut/paste pair carries a wholly-contained span to the paste point, unflagged', function () {
    // 'the quick fox': cut "quick " [4,10) and paste it at 7 of the remaining
    // text ("the fox" → "the foxquick "). The span on "quick" [4,9) travels.
    $result = SpanTransformer::transform([span(4, 9)], [
        ['start' => 4, 'end' => 10, 'text' => '', 'cut_id' => 'c1'],
        ['start' => 7, 'end' => 7, 'text' => 'quick ', 'cut_id' => 'c1'],
    ]);

    expect($result)->toBe([
        ['start' => 7, 'end' => 12, 'needsReview' => false, 'deleted' => false],
    ]);
});

test('a span outside the cut range treats the pair as an ordinary delete and insert', function () {
    // Span on "fox" [10,13) of 'the quick fox': the cut [4,10) shifts it back
    // to [4,7), the paste of 6 chars at 0 shifts it to [10,13).
    $result = SpanTransformer::transform([span(10, 13)], [
        ['start' => 4, 'end' => 10, 'text' => '', 'cut_id' => 'c1'],
        ['start' => 0, 'end' => 0, 'text' => 'quick ', 'cut_id' => 'c1'],
    ]);

    expect($result)->toBe([
        ['start' => 10, 'end' => 13, 'needsReview' => false, 'deleted' => false],
    ]);
});

test('a span partially overlapping the cut range is trimmed and flagged, not carried', function () {
    // Span [2,6) straddles the cut [4,10): its tail is cut away.
    $result = SpanTransformer::transform([span(2, 6)], [
        ['start' => 4, 'end' => 10, 'text' => '', 'cut_id' => 'c1'],
        ['start' => 5, 'end' => 5, 'text' => 'quick ', 'cut_id' => 'c1'],
    ]);

    expect($result)->toBe([
        ['start' => 2, 'end' => 4, 'needsReview' => true, 'deleted' => false],
    ]);
});

test('ops between a cut and its paste move the carried span\'s eventual tombstone, not the span', function () {
    // Cut [4,10), type "XX" at 0, paste at 9 (post-typing coordinates).
    // The carried span still lands relative to the paste point.
    $result = SpanTransformer::transform([span(4, 9)], [
        ['start' => 4, 'end' => 10, 'text' => '', 'cut_id' => 'c1'],
        ['start' => 0, 'end' => 0, 'text' => 'XX'],
        ['start' => 9, 'end' => 9, 'text' => 'quick ', 'cut_id' => 'c1'],
    ]);

    expect($result)->toBe([
        ['start' => 9, 'end' => 14, 'needsReview' => false, 'deleted' => false],
    ]);
});

test('a relocation paste landing exactly at another span\'s end does not extend it', function () {
    // End-gravity absorbs *typing* done right after a span — but pasted
    // relocated words belong to the citation carried with them, not to the
    // neighbour that happens to end where they arrive.
    // 'one\ntwo' with spans on "one" [0,3) and "two" [4,7): cut "one\n"
    // [0,4) and paste it after "two" (post-cut offset 3).
    $result = SpanTransformer::transform([span(0, 3), span(4, 7)], [
        ['start' => 0, 'end' => 4, 'text' => '', 'cut_id' => 'c1'],
        ['start' => 3, 'end' => 3, 'text' => "one\n", 'cut_id' => 'c1'],
    ]);

    expect($result)->toBe([
        ['start' => 3, 'end' => 6, 'needsReview' => false, 'deleted' => false], // "one", relocated
        ['start' => 0, 'end' => 3, 'needsReview' => false, 'deleted' => false], // "two", NOT extended
    ]);
});

test('a cut whose paste never arrives degrades to a deletion: the span tombstones at the cut point', function () {
    $result = SpanTransformer::transform([span(4, 9)], [
        ['start' => 4, 'end' => 10, 'text' => '', 'cut_id' => 'c1'],
    ]);

    expect($result)->toBe([
        ['start' => 4, 'end' => 4, 'needsReview' => true, 'deleted' => true],
    ]);
});

test('several disjoint ops in one save each transform their own span correctly', function () {
    // 'the cat sat' (11 chars): spanA {0,3} "the", spanB {8,11} "sat".
    // op1 prepends "X" at the very start (shifts both spans by +1).
    // op2 appends "Y" immediately after spanB's new end (absorbed, per end-gravity),
    // expressed in the coordinate space AFTER op1 has already been applied.
    $result = SpanTransformer::transform([span(0, 3), span(8, 11)], [
        ['start' => 0, 'end' => 0, 'text' => 'X'],
        ['start' => 12, 'end' => 12, 'text' => 'Y'],
    ]);

    expect($result)->toBe([
        ['start' => 1, 'end' => 4, 'needsReview' => false, 'deleted' => false],
        ['start' => 9, 'end' => 13, 'needsReview' => false, 'deleted' => false],
    ]);
});

test('needs_review stays flagged through a later, unrelated op', function () {
    $result = SpanTransformer::transform([span(4, 7)], [
        ['start' => 4, 'end' => 7, 'text' => 'dog'],
        ['start' => 20, 'end' => 20, 'text' => 'Z'],
    ]);

    expect($result)->toBe([
        ['start' => 4, 'end' => 7, 'needsReview' => true, 'deleted' => false],
    ]);
});

test('needs_review stays flagged once already true, even through an absorbing op', function () {
    $result = SpanTransformer::transform([span(4, 7, needsReview: true)], [
        ['start' => 5, 'end' => 5, 'text' => 'X'],
    ]);

    expect($result)->toBe([
        ['start' => 4, 'end' => 8, 'needsReview' => true, 'deleted' => false],
    ]);
});
