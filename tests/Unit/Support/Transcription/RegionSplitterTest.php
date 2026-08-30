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
