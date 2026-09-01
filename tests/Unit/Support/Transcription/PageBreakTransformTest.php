<?php

use App\Support\Transcription\SpanTransformer;

/**
 * SpanTransformer::transformPoints — how a page break moves when the text
 * around it is edited. A break is a single offset, not a zero-width span, and
 * the difference is the gravity at the break itself.
 */

/**
 * @param  list<int>  $points
 * @param  list<array{start: int, end: int, text: string}>  $ops
 * @return list<int>
 */
function moved(array $points, array $ops): array
{
    return SpanTransformer::transformPoints($points, $ops);
}

test('an edit before a break pushes it along', function () {
    expect(moved([10], [['start' => 0, 'end' => 0, 'text' => 'abc']]))->toBe([13]);
});

test('an edit after a break leaves it alone', function () {
    expect(moved([10], [['start' => 20, 'end' => 20, 'text' => 'abc']]))->toBe([10]);
});

test('typing at the top of a page keeps the text on that page', function () {
    // The case that decides the gravity, and the one an editor transcribing
    // page by page meets every time she starts a page: the cursor sits
    // exactly at the break and the first words must land after it, on the new
    // page — not on the one before.
    expect(moved([10], [['start' => 10, 'end' => 10, 'text' => 'μῆνιν']]))->toBe([10]);
});

test('a zero-width span would have got that backwards', function () {
    // Kept as a statement of why transformPoints exists at all: treated as a
    // span, the break jumps past the insertion and the words land on the
    // previous page.
    $asSpan = SpanTransformer::transform(
        [['start' => 10, 'end' => 10, 'needsReview' => false]],
        [['start' => 10, 'end' => 10, 'text' => 'μῆνιν']],
    );

    expect($asSpan[0]['start'])->toBe(15)
        ->and(moved([10], [['start' => 10, 'end' => 10, 'text' => 'μῆνιν']]))->toBe([10]);
});

test('deleting text before a break pulls it back', function () {
    expect(moved([10], [['start' => 2, 'end' => 5, 'text' => '']]))->toBe([7]);
});

test('a break inside deleted text lands where the deletion began', function () {
    // The page keeps existing; it is emptied, not abolished.
    expect(moved([10], [['start' => 5, 'end' => 20, 'text' => '']]))->toBe([5]);
});

test('deleting a whole page leaves its break beside the next one', function () {
    // Two pages starting at the same offset is what an empty page looks like,
    // which is why nothing enforces distinct offsets.
    expect(moved([10, 20], [['start' => 10, 'end' => 20, 'text' => '']]))->toBe([10, 10]);
});

test('several ops apply in order, each against the last result', function () {
    expect(moved([10], [
        ['start' => 0, 'end' => 0, 'text' => 'ab'],
        ['start' => 0, 'end' => 4, 'text' => ''],
    ]))->toBe([8]);
});

test('breaks are never deleted, however much text goes', function () {
    expect(moved([3, 7], [['start' => 0, 'end' => 100, 'text' => '']]))->toBe([0, 0]);
});
