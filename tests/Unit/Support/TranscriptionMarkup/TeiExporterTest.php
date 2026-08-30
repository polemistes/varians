<?php

use App\Support\TranscriptionMarkup\TeiExporter;

test('plain text is passed through unescaped for safe characters', function () {
    expect(TeiExporter::toXmlFragment('μῆνιν ἄειδε'))->toBe('μῆνιν ἄειδε');
});

test('plain text with XML special characters is escaped', function () {
    expect(TeiExporter::toXmlFragment('a & b < c'))->toBe('a &amp; b &lt; c');
});

test('a restored gap renders as a supplied element with reason lost', function () {
    expect(TeiExporter::toXmlFragment('[ἄειδε]'))
        ->toBe('<supplied reason="lost">ἄειδε</supplied>');
});

test('an unrestored gap with known extent renders as a gap element with quantity', function () {
    expect(TeiExporter::toXmlFragment('[3]'))
        ->toBe('<gap reason="lost" quantity="3" unit="character"/>');
});

test('an unrestored gap with unknown extent renders as a bare gap element', function () {
    expect(TeiExporter::toXmlFragment('[?]'))
        ->toBe('<gap reason="lost"/>');
});

test('illegible ink of known extent renders as unclear wrapping a gap', function () {
    expect(TeiExporter::toXmlFragment('{4}'))
        ->toBe('<unclear><gap reason="illegible" quantity="4" unit="character"/></unclear>');
});

test('illegible ink of unknown extent renders as unclear wrapping a bare gap', function () {
    expect(TeiExporter::toXmlFragment('{?}'))
        ->toBe('<unclear><gap reason="illegible"/></unclear>');
});

test('an uncertain reading renders as an unclear element with its text', function () {
    expect(TeiExporter::toXmlFragment('_Ἀχιλῆος_'))
        ->toBe('<unclear>Ἀχιλῆος</unclear>');
});

test('a full line with every construct renders as the expected TEI fragment', function () {
    $xml = TeiExporter::toXmlFragment('μῆνιν [ἄειδε] θεὰ Πηληϊάδεω {4} _Ἀχιλῆος_');

    expect($xml)->toBe(
        'μῆνιν <supplied reason="lost">ἄειδε</supplied> θεὰ Πηληϊάδεω '
        .'<unclear><gap reason="illegible" quantity="4" unit="character"/></unclear> '
        .'<unclear>Ἀχιλῆος</unclear>'
    );
});
