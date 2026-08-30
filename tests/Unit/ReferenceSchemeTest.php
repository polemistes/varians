<?php

use App\Models\ReferenceScheme;

test('formats a book and line address', function () {
    $scheme = new ReferenceScheme([
        'levels' => [
            ['key' => 'book', 'label' => 'Book', 'type' => 'integer', 'separator' => ''],
            ['key' => 'line', 'label' => 'Line', 'type' => 'integer', 'separator' => '.'],
        ],
    ]);

    $formatted = $scheme->format(['book' => 1, 'line' => 234]);

    expect($formatted['label'])->toBe('1.234')
        ->and($formatted['sort_key'])->toBe('00000001.00000234');
});

test('formats a Stephanus page address', function () {
    $scheme = new ReferenceScheme([
        'levels' => [
            ['key' => 'page', 'label' => 'Page', 'type' => 'integer', 'separator' => ''],
            ['key' => 'section', 'label' => 'Section', 'type' => 'string', 'separator' => ''],
        ],
    ]);

    $formatted = $scheme->format(['page' => 327, 'section' => 'a']);

    expect($formatted['label'])->toBe('327a')
        ->and($formatted['sort_key'])->toBe('00000327.a       ');
});

test('sort keys order Stephanus sections correctly', function () {
    $scheme = new ReferenceScheme([
        'levels' => [
            ['key' => 'page', 'label' => 'Page', 'type' => 'integer', 'separator' => ''],
            ['key' => 'section', 'label' => 'Section', 'type' => 'string', 'separator' => ''],
        ],
    ]);

    $a = $scheme->format(['page' => 327, 'section' => 'a'])['sort_key'];
    $b = $scheme->format(['page' => 327, 'section' => 'b'])['sort_key'];
    $nextPage = $scheme->format(['page' => 328, 'section' => 'a'])['sort_key'];

    expect(strcmp($a, $b))->toBeLessThan(0)
        ->and(strcmp($b, $nextPage))->toBeLessThan(0);
});

test('an uppercase suffix (a line part) preserves case in the label', function () {
    $scheme = new ReferenceScheme([
        'levels' => [
            ['key' => 'line', 'label' => 'Line', 'type' => 'integer', 'separator' => ''],
            ['key' => 'part', 'label' => 'Part', 'type' => 'string', 'separator' => ''],
        ],
    ]);

    expect($scheme->format(['line' => 45, 'part' => 'A'])['label'])->toBe('45A')
        ->and($scheme->format(['line' => 45, 'part' => 'a'])['label'])->toBe('45a');
});

test('uppercase line parts sort before lowercase inserted lines at the same position', function () {
    // By convention: uppercase (45A, 45B) marks parts of line 45 (e.g. a line split
    // between speakers); lowercase (45a, 45b) marks new lines inserted between 45
    // and 46 (e.g. a conjectured lacuna). Both must sort between 45 and 46, with
    // the parts of 45 itself preceding anything inserted after it.
    $scheme = new ReferenceScheme([
        'levels' => [
            ['key' => 'line', 'label' => 'Line', 'type' => 'integer', 'separator' => ''],
            ['key' => 'part', 'label' => 'Part', 'type' => 'string', 'separator' => ''],
        ],
    ]);

    $bare = $scheme->format(['line' => 45])['sort_key'];
    $partA = $scheme->format(['line' => 45, 'part' => 'A'])['sort_key'];
    $partB = $scheme->format(['line' => 45, 'part' => 'B'])['sort_key'];
    $insertedA = $scheme->format(['line' => 45, 'part' => 'a'])['sort_key'];
    $nextLine = $scheme->format(['line' => 46])['sort_key'];

    expect(strcmp($bare, $partA))->toBeLessThan(0)
        ->and(strcmp($partA, $partB))->toBeLessThan(0)
        ->and(strcmp($partB, $insertedA))->toBeLessThan(0)
        ->and(strcmp($insertedA, $nextLine))->toBeLessThan(0);
});

test('parses a book and line label back into an address', function () {
    $scheme = new ReferenceScheme([
        'levels' => [
            ['key' => 'book', 'label' => 'Book', 'type' => 'integer', 'separator' => ''],
            ['key' => 'line', 'label' => 'Line', 'type' => 'integer', 'separator' => '.'],
        ],
    ]);

    expect($scheme->parseLabel('1.234'))->toBe(['book' => 1, 'line' => 234]);
});

test('parses a Stephanus label back into an address', function () {
    $scheme = new ReferenceScheme([
        'levels' => [
            ['key' => 'page', 'label' => 'Page', 'type' => 'integer', 'separator' => ''],
            ['key' => 'section', 'label' => 'Section', 'type' => 'string', 'separator' => ''],
        ],
    ]);

    expect($scheme->parseLabel('327a'))->toBe(['page' => 327, 'section' => 'a']);
});

test('parseLabel is the inverse of format', function () {
    $scheme = new ReferenceScheme([
        'levels' => [
            ['key' => 'book', 'label' => 'Book', 'type' => 'integer', 'separator' => ''],
            ['key' => 'line', 'label' => 'Line', 'type' => 'integer', 'separator' => '.'],
        ],
    ]);

    $address = ['book' => 3, 'line' => 45];
    $label = $scheme->format($address)['label'];

    expect($scheme->parseLabel($label))->toBe($address);
});

test('parses an alphanumeric label into an integer-type level without truncating it', function () {
    $scheme = new ReferenceScheme([
        'levels' => [
            ['key' => 'line', 'label' => 'Line', 'type' => 'integer', 'separator' => ''],
        ],
    ]);

    expect($scheme->parseLabel('4a'))->toBe(['line' => '4a']);
});

test('an alphanumeric integer-level value sorts naturally between its numeric neighbours', function () {
    $scheme = new ReferenceScheme([
        'levels' => [
            ['key' => 'line', 'label' => 'Line', 'type' => 'integer', 'separator' => ''],
        ],
    ]);

    $four = $scheme->format(['line' => 4])['sort_key'];
    $fourA = $scheme->format(['line' => '4a'])['sort_key'];
    $five = $scheme->format(['line' => 5])['sort_key'];

    expect(strcmp($four, $fourA))->toBeLessThan(0)
        ->and(strcmp($fourA, $five))->toBeLessThan(0);
});

test('pure-integer labels still parse and format exactly as before', function () {
    $scheme = new ReferenceScheme([
        'levels' => [
            ['key' => 'book', 'label' => 'Book', 'type' => 'integer', 'separator' => ''],
            ['key' => 'line', 'label' => 'Line', 'type' => 'integer', 'separator' => '.'],
        ],
    ]);

    expect($scheme->parseLabel('1.234'))->toBe(['book' => 1, 'line' => 234])
        ->and($scheme->format(['book' => 1, 'line' => 234])['sort_key'])->toBe('00000001.00000234');
});

test('parseLabel returns null for a label that does not match the scheme', function () {
    $scheme = new ReferenceScheme([
        'levels' => [
            ['key' => 'book', 'label' => 'Book', 'type' => 'integer', 'separator' => ''],
            ['key' => 'line', 'label' => 'Line', 'type' => 'integer', 'separator' => '.'],
        ],
    ]);

    expect($scheme->parseLabel('not a citation'))->toBeNull();
});
