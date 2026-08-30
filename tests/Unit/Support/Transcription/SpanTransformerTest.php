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

test('deleting exactly a span\'s own text with nothing to replace it deletes the span', function () {
    $result = SpanTransformer::transform([span(4, 7)], [
        ['start' => 4, 'end' => 7, 'text' => ''],
    ]);

    expect($result)->toBe([
        ['start' => 4, 'end' => 7, 'needsReview' => false, 'deleted' => true],
    ]);
});

test('a delete wider than a span also deletes it', function () {
    $result = SpanTransformer::transform([span(4, 7)], [
        ['start' => 0, 'end' => 11, 'text' => ''],
    ]);

    expect($result)->toBe([
        ['start' => 4, 'end' => 7, 'needsReview' => false, 'deleted' => true],
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
