<?php

use App\Support\Transcription\RegionSplitter;

test('splitting by character skips whitespace and offsets each unit correctly', function () {
    expect(RegionSplitter::split('ab cd', 'character'))->toBe([
        ['start' => 0, 'end' => 1, 'text' => 'a'],
        ['start' => 1, 'end' => 2, 'text' => 'b'],
        ['start' => 3, 'end' => 4, 'text' => 'c'],
        ['start' => 4, 'end' => 5, 'text' => 'd'],
    ]);
});

test('splitting by word groups runs of non-whitespace characters', function () {
    expect(RegionSplitter::split('ab  cd ef', 'word'))->toBe([
        ['start' => 0, 'end' => 2, 'text' => 'ab'],
        ['start' => 4, 'end' => 6, 'text' => 'cd'],
        ['start' => 7, 'end' => 9, 'text' => 'ef'],
    ]);
});

test('splitting by word includes a trailing word with no closing space', function () {
    expect(RegionSplitter::split('ab cd', 'word'))->toBe([
        ['start' => 0, 'end' => 2, 'text' => 'ab'],
        ['start' => 3, 'end' => 5, 'text' => 'cd'],
    ]);
});

test('splitting handles multibyte text by character, not by byte', function () {
    expect(RegionSplitter::split('λόγος καλός', 'character'))->toHaveCount(10)
        ->and(RegionSplitter::split('λόγος καλός', 'word'))->toBe([
            ['start' => 0, 'end' => 5, 'text' => 'λόγος'],
            ['start' => 6, 'end' => 11, 'text' => 'καλός'],
        ]);
});

test('a span with no non-whitespace characters splits to nothing', function () {
    expect(RegionSplitter::split('   ', 'character'))->toBe([])
        ->and(RegionSplitter::split('   ', 'word'))->toBe([]);
});

test('layout gives each word the horizontal share its characters have of the line', function () {
    ['lines' => $lines, 'units' => $units] = RegionSplitter::layout('a bcd', 'word');

    // Five characters across the band: 'a' takes the first fifth, the space
    // keeps its fifth, 'bcd' the remaining three.
    expect($lines)->toBe(1)
        ->and($units)->toHaveCount(2)
        ->and($units[0])->toMatchArray(['text' => 'a', 'line' => 0, 'x' => 0.0, 'width' => 1 / 5])
        ->and($units[1])->toMatchArray(['text' => 'bcd', 'line' => 0, 'x' => 2 / 5, 'width' => 3 / 5]);
});

test('layout puts each line of the selection in its own band, skipping blank lines', function () {
    ['lines' => $lines, 'units' => $units] = RegionSplitter::layout("ab cd\n\nef", 'word');

    expect($lines)->toBe(2)
        ->and($units)->toHaveCount(3)
        ->and($units[0])->toMatchArray(['start' => 0, 'end' => 2, 'line' => 0])
        ->and($units[1])->toMatchArray(['start' => 3, 'end' => 5, 'line' => 0])
        // 'ef' sits past the two newlines, alone on its band: full width.
        ->and($units[2])->toMatchArray(['start' => 7, 'end' => 9, 'line' => 1, 'x' => 0.0, 'width' => 1.0]);
});

test('layout trims each line independently, so indentation does not shift a band', function () {
    ['units' => $units] = RegionSplitter::layout("ab\n   cd", 'word');

    expect($units[1])->toMatchArray(['text' => 'cd', 'line' => 1, 'x' => 0.0, 'width' => 1.0]);
});

test('layout by line makes each trimmed line one full-width unit on its own band', function () {
    ['lines' => $lines, 'units' => $units] = RegionSplitter::layout("  ab cd \nef", 'line');

    expect($lines)->toBe(2)
        ->and($units)->toHaveCount(2)
        ->and($units[0])->toMatchArray(['start' => 2, 'end' => 7, 'text' => 'ab cd', 'line' => 0, 'x' => 0.0, 'width' => 1.0])
        ->and($units[1])->toMatchArray(['start' => 9, 'end' => 11, 'text' => 'ef', 'line' => 1, 'x' => 0.0, 'width' => 1.0]);
});

test('plain text without markup is splittable', function () {
    expect(RegionSplitter::isSplittable('λόγος καλός'))->toBeTrue();
});

test('text containing a gap, restoration, or uncertain reading is not splittable', function (string $text) {
    expect(RegionSplitter::isSplittable($text))->toBeFalse();
})->with([
    'λόγος [καλός]',
    'λόγος {3}',
    'λόγος [3]',
    'λόγος _καλός_',
]);
