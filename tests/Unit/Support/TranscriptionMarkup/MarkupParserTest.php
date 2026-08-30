<?php

use App\Support\TranscriptionMarkup\InvalidMarkupException;
use App\Support\TranscriptionMarkup\MarkupParser;

test('plain text with no markup parses as a single text token', function () {
    expect(MarkupParser::parse('μῆνιν ἄειδε'))->toBe([
        ['type' => 'text', 'text' => 'μῆνιν ἄειδε'],
    ]);
});

test('a restored gap parses as a supplied token', function () {
    expect(MarkupParser::parse('θεὰ [ἄειδε] Πηληϊάδεω'))->toBe([
        ['type' => 'text', 'text' => 'θεὰ '],
        ['type' => 'supplied', 'text' => 'ἄειδε'],
        ['type' => 'text', 'text' => ' Πηληϊάδεω'],
    ]);
});

test('an unrestored gap with known extent parses with a quantity', function () {
    expect(MarkupParser::parse('θεὰ [3] Πηληϊάδεω'))->toBe([
        ['type' => 'text', 'text' => 'θεὰ '],
        ['type' => 'gap', 'reason' => 'lost', 'quantity' => 3],
        ['type' => 'text', 'text' => ' Πηληϊάδεω'],
    ]);
});

test('an unrestored gap with unknown extent parses with a null quantity', function () {
    expect(MarkupParser::parse('[?]'))->toBe([
        ['type' => 'gap', 'reason' => 'lost', 'quantity' => null],
    ]);
});

test('illegible ink of known extent parses as a gap with reason illegible', function () {
    expect(MarkupParser::parse('{4}'))->toBe([
        ['type' => 'gap', 'reason' => 'illegible', 'quantity' => 4],
    ]);
});

test('illegible ink of unknown extent parses with a null quantity', function () {
    expect(MarkupParser::parse('{?}'))->toBe([
        ['type' => 'gap', 'reason' => 'illegible', 'quantity' => null],
    ]);
});

test('an uncertain reading parses as an unclear token', function () {
    expect(MarkupParser::parse('_Ἀχιλῆος_'))->toBe([
        ['type' => 'unclear', 'text' => 'Ἀχιλῆος'],
    ]);
});

test('a full line with every construct parses in order', function () {
    $tokens = MarkupParser::parse('μῆνιν [ἄειδε] θεὰ Πηληϊάδεω {4} _Ἀχιλῆος_');

    expect($tokens)->toBe([
        ['type' => 'text', 'text' => 'μῆνιν '],
        ['type' => 'supplied', 'text' => 'ἄειδε'],
        ['type' => 'text', 'text' => ' θεὰ Πηληϊάδεω '],
        ['type' => 'gap', 'reason' => 'illegible', 'quantity' => 4],
        ['type' => 'text', 'text' => ' '],
        ['type' => 'unclear', 'text' => 'Ἀχιλῆος'],
    ]);
});

test('isValid returns true for well-formed markup and false for malformed markup', function () {
    expect(MarkupParser::isValid('θεὰ [ἄειδε]'))->toBeTrue()
        ->and(MarkupParser::isValid('θεὰ [ἄειδε'))->toBeFalse();
});

test('a stray unmatched bracket is rejected', function (string $text) {
    MarkupParser::parse($text);
})->throws(InvalidMarkupException::class)->with([
    'θεὰ [ἄειδε',
    'θεὰ ἄειδε]',
    'θεὰ {3',
    'θεὰ _ἄειδε',
]);

test('an empty gap is rejected', function () {
    MarkupParser::parse('[]');
})->throws(InvalidMarkupException::class);

test('an empty illegible marker is rejected', function () {
    MarkupParser::parse('{}');
})->throws(InvalidMarkupException::class);

test('an empty uncertain reading is rejected', function () {
    MarkupParser::parse('__');
})->throws(InvalidMarkupException::class);

test('a zero-length gap quantity is rejected', function () {
    MarkupParser::parse('[0]');
})->throws(InvalidMarkupException::class);

test('reserved characters bleeding across delimiter types are rejected', function () {
    MarkupParser::parse('[abc{def]');
})->throws(InvalidMarkupException::class);

test('markup does not nest', function () {
    MarkupParser::parse('_[abc]_');
})->throws(InvalidMarkupException::class);
