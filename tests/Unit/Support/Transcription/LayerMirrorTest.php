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

test('a line break inside a glued word splits the sibling word at the folded junction', function () {
    // A line pasted flush against another glues two words into one — in
    // BOTH layers. The Enter that separates them lands mid-word, where no
    // plain offset maps; the split point in the sibling is wherever its
    // word's orthography-folded suffix matches ours — even though the
    // prefixes are spelled apart (γιγνεται/γίνεται differ in LENGTH, so a
    // plain character count would split the sibling at the wrong letters).
    $a = "παντα ρει γιγνεταιχαιρʼ\nκατ εριν";
    $b = "πάντα ῥεῖ γίνεταιχαῖρʼ\nκατ᾽ ἔριν";

    // Enter between γιγνεται and χαιρʼ (offset 18 = inside the glue).
    $mirror = LayerMirror::mirror($a, [
        ['start' => 18, 'end' => 18, 'text' => "\n", 'cut_id' => null, 'atomic' => true],
    ], $b);

    expect($mirror)->not->toBeNull()
        ->and($mirror['text'])->toBe("πάντα ῥεῖ γίνεται\nχαῖρʼ\nκατ᾽ ἔριν");
});

test('sibling punctuation at the junction stays with the line it ends', function () {
    // The normalized line ends with a comma the diplomatic lacks, so two
    // splits of the glued word fold alike — before and after the comma.
    // Punctuation binds to the preceding line, so the rightmost wins:
    // Γενετυλλίδος, | νῦν, exactly the sibling's own lineation.
    $a = 'ρει Γενετυλλιδοςνυν δʼ';
    $b = 'ῥεῖ Γενετυλλίδος,νῦν δʼ';

    // Enter between Γενετυλλιδος and νυν (offset 16).
    $mirror = LayerMirror::mirror($a, [
        ['start' => 16, 'end' => 16, 'text' => "\n", 'cut_id' => null, 'atomic' => true],
    ], $b);

    expect($mirror)->not->toBeNull()
        ->and($mirror['text'])->toBe("ῥεῖ Γενετυλλίδος,\nνῦν δʼ");
});

test('a mid-word line break where neither half matches the sibling is skipped', function () {
    $a = 'αβγ ρει';
    $b = 'ωδε ῥεῖ';

    expect(LayerMirror::mirror($a, [
        ['start' => 1, 'end' => 1, 'text' => "\n", 'cut_id' => null, 'atomic' => true],
    ], $b))->toBeNull();
});

test('a letter-level suffix difference still splits by the matching prefix', function () {
    // The word after the junction is spelled apart at the letter level
    // (γιγνεται/γίνεται), so its fold cannot match — but the pasted line's
    // last word before the junction is accent-only, and one matching half
    // pins the point.
    $a = "κατ ερινγιγνεται παντα";
    $b = "κατ᾽ ἔρινγίνεται πάντα";

    // Enter between εριν and γιγνεται (offset 8 = inside the glue).
    $mirror = LayerMirror::mirror($a, [
        ['start' => 8, 'end' => 8, 'text' => "\n", 'cut_id' => null, 'atomic' => true],
    ], $b);

    expect($mirror)->not->toBeNull()
        ->and($mirror['text'])->toBe("κατ᾽ ἔριν\nγίνεται πάντα");
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
