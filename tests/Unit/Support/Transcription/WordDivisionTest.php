<?php

use App\Support\Transcription\WordDivision;

/**
 * A word divided at the end of a manuscript line is ONE word: the
 * transcription writes "ἄνδ-⏎ρα", the hyphen before the line break says
 * the word goes on, and everything that reads words closes the division
 * up. Mirrored in resources/js/lib/wordSpans.ts — this is the contract.
 */
test('a hyphen before a line break joins the word across it', function () {
    expect(WordDivision::words("ἄνδ-\nρα μοι"))->toBe([
        ['start' => 0, 'end' => 7],
        ['start' => 8, 'end' => 11],
    ])
        ->and(WordDivision::words("ἄνδ-\r\nρα"))->toBe([['start' => 0, 'end' => 8]])
        ->and(WordDivision::words("ἄνδ\nρα"))->toHaveCount(2)
        ->and(WordDivision::words('ἄνδ- ρα'))->toHaveCount(2);
});

test('the word text closes the division up; as written keeps it visible', function () {
    expect(WordDivision::wordText("ἄνδ-\nρα μοι", 0, 7))->toBe('ἄνδρα')
        ->and(WordDivision::wordText("ἄνδ-\nρα μοι", 0, 11))->toBe('ἄνδρα μοι')
        ->and(WordDivision::asWritten("ἄνδ-\nρα μοι", 0, 7))->toBe('ἄνδ-|ρα')
        ->and(WordDivision::wordText('ἄνδ- ρα', 0, 7))->toBe('ἄνδ- ρα');
});

test('the line break after a hyphen is not a separator; every other whitespace is', function () {
    $text = "ἄνδ-\nρα μοι";

    expect(WordDivision::isSeparatorAt($text, 4))->toBeFalse()
        ->and(WordDivision::isSeparatorAt($text, 3))->toBeFalse()
        ->and(WordDivision::isSeparatorAt($text, 7))->toBeTrue()
        ->and(WordDivision::isSeparatorAt("ἄνδ\nρα", 3))->toBeTrue()
        ->and(WordDivision::isSeparatorAt($text, 11))->toBeTrue()
        ->and(WordDivision::isSeparatorAt($text, -1))->toBeTrue();
});

test('slicing a long text through the index reads the same characters as mb_substr', function () {
    // Mixed widths — Greek, ASCII, a four-byte emoji, line breaks — so a
    // byte offset is never a character offset, and long enough for the
    // index to be used and for slices to cross its checkpoints.
    $piece = "μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος 😀 the quick fox\n";
    $text = str_repeat($piece, 400);
    $length = mb_strlen($text);

    mt_srand(7);

    foreach (range(1, 200) as $_) {
        $start = mt_rand(0, $length - 1);
        $end = min($length, $start + mt_rand(0, 700));

        expect(WordDivision::slice($text, $start, $end))->toBe(mb_substr($text, $start, $end - $start));
    }

    // Past the end, at a checkpoint exactly, and an empty span.
    expect(WordDivision::slice($text, $length - 3, $length + 50))->toBe(mb_substr($text, $length - 3))
        ->and(WordDivision::slice($text, 256, 512))->toBe(mb_substr($text, 256, 256))
        ->and(WordDivision::slice($text, 1000, 1000))->toBe('')
        ->and(WordDivision::wordText($text, 6, 11))->toBe('ἄειδε');
});

test('a text edited to the same length and ends is not read through the old index', function () {
    $text = str_repeat("alpha beta gamma delta\n", 300);
    $before = WordDivision::slice($text, 3000, 3010);

    // Same length, same first and last 64 bytes: the fingerprint collides,
    // and the index must notice the text is another.
    $edited = substr_replace($text, 'ALPHA', 3000, 5);

    expect(WordDivision::slice($edited, 3000, 3010))->toBe(mb_substr($edited, 3000, 10))
        ->and(WordDivision::slice($edited, 3000, 3010))->not->toBe($before);
});
