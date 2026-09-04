<?php

use App\Support\Transcription\LayerMirror;
use App\Support\Transcription\TextOpApplier;

/** A relocation pair: cut [start,end), later paste the same text at a point. */
function relocationOps(string $text, int $start, int $end, int $paste): array
{
    $cut = mb_substr($text, $start, $end - $start);

    return [
        ['start' => $start, 'end' => $end, 'text' => '', 'cut_id' => 'm1'],
        ['start' => $paste, 'end' => $paste, 'text' => $cut, 'cut_id' => 'm1'],
    ];
}

test('a whole-word move mirrors onto the sibling using its own spellings', function () {
    $a = "γιγνεται παντα\nκατ εριν";
    $b = "γίνεται πάντα\nκατ᾽ ἔριν";

    // Move "γιγνεται " (word one and its trailing space) to the very end.
    $ops = relocationOps($a, 0, 9, mb_strlen($a));
    // The paste position is measured in the post-cut text.
    $ops[1]['start'] = $ops[1]['end'] = mb_strlen($a) - 9;

    $mirror = LayerMirror::mirror($a, $ops, $b);

    expect($mirror)->not->toBeNull()
        ->and($mirror['text'])->toBe("πάντα\nκατ᾽ ἔρινγίνεται ")
        ->and(TextOpApplier::applyAll($b, $mirror['ops']))->toBe($mirror['text']);
});

test('a cut through the middle of a word cannot mirror', function () {
    $a = 'γιγνεται παντα';
    $b = 'γίνεται πάντα';

    $ops = relocationOps($a, 3, 9, 0);

    expect(LayerMirror::mirror($a, $ops, $b))->toBeNull();
});

test('layers whose word patterns already disagree cannot mirror', function () {
    $a = 'one two three';
    $b = 'one two';

    expect(LayerMirror::mirror($a, relocationOps($a, 0, 4, 9), $b))->toBeNull();
});

test('ops without a relocation pair mirror nothing', function () {
    expect(LayerMirror::mirror('one two', [
        ['start' => 0, 'end' => 0, 'text' => 'x', 'cut_id' => null],
    ], 'one two'))->toBeNull();
});

test('typing inside a word between the pair halves does not break the mirror', function () {
    $a = 'alpha beta gamma';
    $b = 'alfa beta gamma';

    $ops = [
        // Cut "alpha " from the head.
        ['start' => 0, 'end' => 6, 'text' => '', 'cut_id' => 'm1'],
        // Type a letter inside "beta" (now at the head): beta -> berta.
        ['start' => 2, 'end' => 2, 'text' => 'r', 'cut_id' => null],
        // Paste at the end of the (typed-in) text "berta gamma".
        ['start' => 11, 'end' => 11, 'text' => 'alpha ', 'cut_id' => 'm1'],
    ];

    $mirror = LayerMirror::mirror($a, $ops, $b);

    // The typed letter stays this layer's own; only the move mirrors.
    expect($mirror)->not->toBeNull()
        ->and($mirror['text'])->toBe('beta gammaalfa ');
});

test('an atomic whole-word insertion mirrors verbatim', function () {
    $a = 'γιγνεται παντα';
    $b = 'γίνεται πάντα';

    // Paste "ῥει " at the head — a whole-gesture edit on a word boundary.
    $mirror = LayerMirror::mirror($a, [
        ['start' => 0, 'end' => 0, 'text' => 'ῥει ', 'cut_id' => null, 'atomic' => true],
    ], $b);

    expect($mirror)->not->toBeNull()
        ->and($mirror['text'])->toBe('ῥει γίνεται πάντα')
        ->and($mirror['relocated'])->toBeFalse();
});

test('an atomic deletion of a selected word removes its counterpart', function () {
    $a = 'γιγνεται παντα ρει';
    $b = 'γίνεται πάντα ῥεῖ';

    // Delete "παντα " — endpoints on word boundaries.
    $mirror = LayerMirror::mirror($a, [
        ['start' => 9, 'end' => 15, 'text' => '', 'cut_id' => null, 'atomic' => true],
    ], $b);

    expect($mirror)->not->toBeNull()
        ->and($mirror['text'])->toBe('γίνεται ῥεῖ');
});

test('a keystroke never mirrors, even on a word boundary', function () {
    $a = 'γιγνεται παντα';
    $b = 'γίνεται πάντα';

    // Typing is where a spelling change begins — it stays in its layer.
    expect(LayerMirror::mirror($a, [
        ['start' => 0, 'end' => 0, 'text' => 'x', 'cut_id' => null],
    ], $b))->toBeNull();
});

test('an atomic edit inside a word is a spelling edit and is skipped, not aborted', function () {
    $a = 'γιγνεται παντα';
    $b = 'γίνεται πάντα';

    // One op inside a word (skipped), one on boundaries (mirrored).
    $mirror = LayerMirror::mirror($a, [
        ['start' => 2, 'end' => 3, 'text' => 'χ', 'cut_id' => null, 'atomic' => true],
        ['start' => 14, 'end' => 14, 'text' => ' ρει', 'cut_id' => null, 'atomic' => true],
    ], $b);

    expect($mirror)->not->toBeNull()
        ->and($mirror['text'])->toBe('γίνεται πάντα ρει');
});
