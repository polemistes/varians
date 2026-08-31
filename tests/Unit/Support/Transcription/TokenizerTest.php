<?php

use App\Enums\Tokenization;
use App\Support\Transcription\Tokenizer;

test('whitespace tokenization returns each word with its offset in the full text', function () {
    expect(Tokenizer::tokenize('the quick fox', 0, 13, Tokenization::Whitespace))->toBe([
        ['text' => 'the', 'start' => 0, 'end' => 3],
        ['text' => 'quick', 'start' => 4, 'end' => 9],
        ['text' => 'fox', 'start' => 10, 'end' => 13],
    ]);
});

test('offsets are relative to the whole text, not the extracted span', function () {
    // PassageAligner persists these straight onto LemmaReading, which indexes
    // into the transcription's full text — so a span starting mid-text must
    // still report absolute offsets.
    expect(Tokenizer::tokenize("line one\nthe quick fox", 9, 22, Tokenization::Whitespace))->toBe([
        ['text' => 'the', 'start' => 9, 'end' => 12],
        ['text' => 'quick', 'start' => 13, 'end' => 18],
        ['text' => 'fox', 'start' => 19, 'end' => 22],
    ]);
});

test('runs of whitespace collapse without producing empty tokens', function () {
    expect(Tokenizer::tokenize("a  b\n\tc", 0, 7, Tokenization::Whitespace))->toBe([
        ['text' => 'a', 'start' => 0, 'end' => 1],
        ['text' => 'b', 'start' => 3, 'end' => 4],
        ['text' => 'c', 'start' => 6, 'end' => 7],
    ]);
});

test('leading and trailing whitespace produce no empty tokens', function () {
    expect(Tokenizer::tokenize('  fox  ', 0, 7, Tokenization::Whitespace))->toBe([
        ['text' => 'fox', 'start' => 2, 'end' => 5],
    ]);
});

test('tokenizing counts characters, not bytes', function () {
    // Greek is multibyte; offsets must line up with mb_substr, which is what
    // every consumer of a LemmaReading's offsets uses.
    $text = 'τοσοῦτοι μὲν οὖν';

    expect(Tokenizer::tokenize($text, 0, mb_strlen($text), Tokenization::Whitespace))->toBe([
        ['text' => 'τοσοῦτοι', 'start' => 0, 'end' => 8],
        ['text' => 'μὲν', 'start' => 9, 'end' => 12],
        ['text' => 'οὖν', 'start' => 13, 'end' => 16],
    ]);
});

test('an empty span yields no tokens', function () {
    expect(Tokenizer::tokenize('the fox', 3, 3, Tokenization::Whitespace))->toBe([]);
});
