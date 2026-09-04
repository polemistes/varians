<?php

use App\Support\Transcription\WordSpans;

test('a character range snaps outward to whole words', function () {
    // "γιγνεται παντα ρει" — words [0,8) [9,14) [15,18)
    $text = 'γιγνεται παντα ρει';

    expect(WordSpans::toWordRange($text, 2, 11))->toBe([0, 2])
        ->and(WordSpans::toWordRange($text, 9, 14))->toBe([1, 2])
        ->and(WordSpans::toWordRange($text, 0, 18))->toBe([0, 3]);
});

test('a range in pure whitespace covers no word', function () {
    expect(WordSpans::toWordRange('αβ  γδ', 2, 4))->toBe([1, 1]);
});

test('the same word range projects onto each layer\'s own spelling', function () {
    // The whole point: word coordinates survive the spelling difference.
    $diplomatic = 'γιγνεται παντα';
    $normalized = 'γίνεται πάντα';

    [$from, $to] = WordSpans::toWordRange($normalized, 8, 13); // πάντα

    expect([$from, $to])->toBe([1, 2])
        ->and(WordSpans::toCharRange($diplomatic, $from, $to))->toBe([9, 14])
        ->and(WordSpans::toCharRange($normalized, $from, $to))->toBe([8, 13]);
});

test('an empty word range collapses to the boundary before it', function () {
    $text = 'αβ γδ';

    expect(WordSpans::toCharRange($text, 1, 1))->toBe([3, 3])
        ->and(WordSpans::toCharRange($text, 5, 5))->toBe([5, 5])
        ->and(WordSpans::toCharRange('', 0, 0))->toBe([0, 0]);
});

test('sub-word anchors keep their place inside a word and snap across whitespace', function () {
    $text = 'γιγνεται παντα';

    // Inside the second word, two characters in.
    expect(WordSpans::startAnchor($text, 11))->toBe(['word' => 1, 'char' => 2])
        // In the separator: a start snaps forward, an end snaps back.
        ->and(WordSpans::startAnchor($text, 8))->toBe(['word' => 1, 'char' => 0])
        ->and(WordSpans::endAnchor($text, 8))->toBe(['word' => 0, 'char' => 8]);
});

test('an anchor clamps to the projecting layer\'s own word length', function () {
    // char 7 of γιγνεται exists; γίνεται is shorter, so it clamps to its end.
    $anchor = WordSpans::startAnchor('γιγνεται παντα', 7);

    expect($anchor)->toBe(['word' => 0, 'char' => 7])
        ->and(WordSpans::fromAnchor('γίνεται πάντα', 0, 7))->toBe(7)
        ->and(WordSpans::fromAnchor('γίνεται πάντα', $anchor['word'], $anchor['char']))->toBe(7);
});

test('anchors and projections tolerate empty text and out-of-range words', function () {
    expect(WordSpans::startAnchor('', 5))->toBe(['word' => 0, 'char' => 0])
        ->and(WordSpans::endAnchor('', 5))->toBe(['word' => 0, 'char' => 0])
        ->and(WordSpans::fromAnchor('', 3, 2))->toBe(0)
        ->and(WordSpans::fromAnchor('αβ', 9, 1))->toBe(1);
});
