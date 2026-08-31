<?php

use App\Support\Transcription\GreekText;

test('stripping accents leaves breathings standing', function () {
    // ἄνθρωπος has both a psili and an oxia on the alpha; only the oxia goes.
    expect(GreekText::stripAccents('ἄνθρωπος'))->toBe('ἀνθρωπος')
        // οὖν keeps its psili: only the perispomeni is an accent.
        ->and(GreekText::stripAccents('τοσοῦτοι μὲν οὖν'))->toBe('τοσουτοι μεν οὐν');
});

test('stripping breathings leaves accents standing', function () {
    expect(GreekText::stripBreathings('ἄνθρωπος'))->toBe('άνθρωπος')
        // and conversely keeps its perispomeni when the psili goes.
        ->and(GreekText::stripBreathings('οὖν'))->toBe('οῦν');
});

test('stripping diacritics removes accents, breathings, iota subscript and diaeresis', function () {
    expect(GreekText::stripDiacritics('ἄνθρωπος'))->toBe('ανθρωπος')
        ->and(GreekText::stripDiacritics('τῷ'))->toBe('τω')          // iota subscript
        ->and(GreekText::stripDiacritics('προϊέναι'))->toBe('προιεναι'); // diaeresis
});

test('stripping punctuation leaves the words alone', function () {
    expect(GreekText::stripPunctuation('τοσοῦτοι, μὲν· οὖν;'))->toBe('τοσοῦτοι μὲν οὖν');
});

test('markup delimiters survive every strip', function () {
    // Removing these would destroy the record of what is lost or illegible,
    // and invalidate every offset recorded against the text.
    $marked = 'το[σου]τοι {3} _μεν_';

    expect(GreekText::stripPunctuation($marked))->toBe($marked)
        ->and(GreekText::stripDiacritics('το[σοῦ]τοι'))->toBe('το[σου]τοι');
});

test('the result is composed, however the input was encoded', function () {
    $decomposed = Normalizer::normalize('τοσοῦτοι', Normalizer::FORM_D);

    expect(GreekText::stripAccents($decomposed))
        ->toBe(Normalizer::normalize('τοσουτοι', Normalizer::FORM_C));
});

test('folding makes two spellings equal only where they differ in orthography', function () {
    // Accent, breathing and pointing alone.
    expect(GreekText::foldOrthography('οὖν'))->toBe(GreekText::foldOrthography('ουν'))
        ->and(GreekText::foldOrthography('μὲν,'))->toBe(GreekText::foldOrthography('μεν'))
        ->and(GreekText::foldOrthography('Μὲν'))->toBe(GreekText::foldOrthography('μεν'));

    // A different word stays different.
    expect(GreekText::foldOrthography('μὲν'))->not->toBe(GreekText::foldOrthography('δὲ'));
});
