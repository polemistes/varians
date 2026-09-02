<?php

use App\Support\Transcription\LayerCorrespondence;

test('layers with the same words in the same lines are in step whatever the spellings', function () {
    // Normalization changes characters within a word — γίγνομαι/γίνομαι
    // differ in length, never in position.
    expect(LayerCorrespondence::divergence(
        "γιγνεται δε παντα\nκατ εριν",
        "γίνεται δὲ πάντα\nκατ᾽ ἔριν,",
    ))->toBeNull();
});

test('a line with a different word count is the first divergence', function () {
    expect(LayerCorrespondence::divergence(
        "one two three\nfour five",
        "one two three\nfour five six",
    ))->toBe(['line' => 2, 'a_words' => 2, 'b_words' => 3]);
});

test('a line only one layer has reports null for the other side', function () {
    expect(LayerCorrespondence::divergence("one two\nthree", 'one two'))
        ->toBe(['line' => 2, 'a_words' => 1, 'b_words' => null]);
});

test('an extra blank line is a divergence too — page breaks live in lines', function () {
    expect(LayerCorrespondence::divergence("one\n\ntwo", "one\ntwo"))
        ->toBe(['line' => 2, 'a_words' => 0, 'b_words' => 1]);
});

test('the pattern collapses words and keeps whitespace verbatim', function () {
    expect(LayerCorrespondence::pattern("γίγνομαι  δὲ\nπάντα"))
        ->toBe("w  w\nw")
        ->and(LayerCorrespondence::pattern("γίνομαι  δὲ\nπάντα"))
        ->toBe("w  w\nw");
});

test('words are measured in characters, not bytes', function () {
    expect(LayerCorrespondence::words('αβ γδ'))->toBe([
        ['start' => 0, 'end' => 2],
        ['start' => 3, 'end' => 5],
    ]);
});
