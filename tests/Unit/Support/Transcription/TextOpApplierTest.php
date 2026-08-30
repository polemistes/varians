<?php

use App\Support\Transcription\TextOpApplier;

test('a single insertion is applied at the given position', function () {
    $result = TextOpApplier::applyAll('the sat', [
        ['start' => 4, 'end' => 4, 'text' => 'cat '],
    ]);

    expect($result)->toBe('the cat sat');
});

test('a single deletion removes the given range', function () {
    $result = TextOpApplier::applyAll('the cat sat', [
        ['start' => 4, 'end' => 8, 'text' => ''],
    ]);

    expect($result)->toBe('the sat');
});

test('a replacement swaps the given range for new text', function () {
    $result = TextOpApplier::applyAll('the cat sat', [
        ['start' => 4, 'end' => 7, 'text' => 'dog'],
    ]);

    expect($result)->toBe('the dog sat');
});

test('multibyte text is sliced by character, not by byte', function () {
    $result = TextOpApplier::applyAll('μῆνιν ἄειδε', [
        ['start' => 6, 'end' => 11, 'text' => 'θεὰ'],
    ]);

    expect($result)->toBe('μῆνιν θεὰ');
});

test('a sequence of ops is applied in order, each against the previous result', function () {
    $result = TextOpApplier::applyAll('the cat sat', [
        ['start' => 0, 'end' => 0, 'text' => 'X'],
        ['start' => 12, 'end' => 12, 'text' => 'Y'],
    ]);

    expect($result)->toBe('Xthe cat satY');
});
