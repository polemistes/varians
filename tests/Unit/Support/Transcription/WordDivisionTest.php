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
