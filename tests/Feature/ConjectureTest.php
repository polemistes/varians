<?php

use App\Enums\ConjectureType;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\User;

test('an editor can record a standalone conjecture for a passage', function () {
    $this->actingAs(User::factory()->editor()->create());
    $passage = CanonicalPassage::factory()->create();

    $response = $this->post(route('conjectures.store', $passage), [
        'text' => 'οἰωνοῖσΐ',
        'note' => 'metri causa',
    ]);

    $response->assertRedirect();

    $conjecture = Conjecture::sole();
    expect($conjecture->canonical_passage_id)->toBe($passage->id)
        ->and($conjecture->text)->toBe('οἰωνοῖσΐ')
        ->and($conjecture->note)->toBe('metri causa');
});

test('a conjecture can record who first proposed it and where it was published, distinct from who entered it', function () {
    $editor = User::factory()->editor()->create();
    $this->actingAs($editor);
    $passage = CanonicalPassage::factory()->create();

    $this->post(route('conjectures.store', $passage), [
        'text' => 'οἰωνοῖσΐ',
        'proposed_by' => 'Bentley',
        'bibliography' => 'Bentley, Emendationes, 1713',
    ]);

    $conjecture = Conjecture::sole();
    expect($conjecture->proposed_by)->toBe('Bentley')
        ->and($conjecture->bibliography)->toBe('Bentley, Emendationes, 1713')
        ->and($conjecture->user_id)->toBe($editor->id);
});

test('proposed_by and bibliography are optional', function () {
    $this->actingAs(User::factory()->editor()->create());
    $passage = CanonicalPassage::factory()->create();

    $response = $this->post(route('conjectures.store', $passage), ['text' => 'reading']);

    $response->assertRedirect();
    $conjecture = Conjecture::sole();
    expect($conjecture->proposed_by)->toBeNull()
        ->and($conjecture->bibliography)->toBeNull();
});

test('a conjecture requires text', function () {
    $this->actingAs(User::factory()->editor()->create());
    $passage = CanonicalPassage::factory()->create();

    $response = $this->post(route('conjectures.store', $passage), []);

    $response->assertInvalid(['text']);
    expect(Conjecture::count())->toBe(0);
});

test('an editor can update a conjecture', function () {
    $this->actingAs(User::factory()->editor()->create());
    $conjecture = Conjecture::factory()->create();

    $response = $this->patch(route('conjectures.update', $conjecture), ['text' => 'revised reading']);

    $response->assertRedirect();
    expect($conjecture->fresh()->text)->toBe('revised reading');
});

test('an editor can delete a conjecture', function () {
    $this->actingAs(User::factory()->editor()->create());
    $conjecture = Conjecture::factory()->create();

    $response = $this->delete(route('conjectures.destroy', $conjecture));

    $response->assertRedirect();
    expect(Conjecture::find($conjecture->id))->toBeNull();
});

test('a guest cannot record a conjecture', function () {
    $this->actingAs(User::factory()->create());
    $passage = CanonicalPassage::factory()->create();

    $response = $this->post(route('conjectures.store', $passage), ['text' => 'reading']);

    $response->assertForbidden();
    expect(Conjecture::count())->toBe(0);
});

test('a conjecture defaults to a plain substitution', function () {
    $this->actingAs(User::factory()->editor()->create());
    $passage = CanonicalPassage::factory()->create();

    $this->post(route('conjectures.store', $passage), ['text' => 'reading']);

    expect(Conjecture::sole()->type)->toBe(ConjectureType::Substitution);
});

test('a bare lacuna needs no proposed text — only credit for noticing the gap', function () {
    $this->actingAs(User::factory()->editor()->create());
    $passage = CanonicalPassage::factory()->create();

    $response = $this->post(route('conjectures.store', $passage), [
        'type' => 'lacuna',
        'extent' => 'one line',
        'proposed_by' => 'Wolf',
    ]);

    $response->assertRedirect();
    $conjecture = Conjecture::sole();
    expect($conjecture->type)->toBe(ConjectureType::Lacuna)
        ->and($conjecture->text)->toBeNull()
        ->and($conjecture->extent)->toBe('one line')
        ->and($conjecture->proposed_by)->toBe('Wolf');
});

test('a lacuna can record an estimated character extent for sizing its gap glyph', function () {
    $this->actingAs(User::factory()->editor()->create());
    $passage = CanonicalPassage::factory()->create();

    $response = $this->post(route('conjectures.store', $passage), [
        'type' => 'lacuna',
        'extent' => 'one line',
        'extent_characters' => 30,
    ]);

    $response->assertRedirect();
    expect(Conjecture::sole()->extent_characters)->toBe(30);
});

test('extent_characters must be a non-negative integer', function () {
    $this->actingAs(User::factory()->editor()->create());
    $passage = CanonicalPassage::factory()->create();

    $response = $this->post(route('conjectures.store', $passage), [
        'type' => 'lacuna',
        'extent_characters' => -1,
    ]);

    $response->assertInvalid(['extent_characters']);
});

test('a lacuna is rejected if given its own text — a restoration is a separate supplement', function () {
    $this->actingAs(User::factory()->editor()->create());
    $passage = CanonicalPassage::factory()->create();

    $response = $this->post(route('conjectures.store', $passage), [
        'type' => 'lacuna',
        'text' => 'restored words',
        'proposed_by' => 'Wolf',
    ]);

    $response->assertInvalid(['text']);
    expect(Conjecture::count())->toBe(0);
});

test('several supplements, from different proposers, can target the same lacuna', function () {
    $this->actingAs(User::factory()->editor()->create());
    $passage = CanonicalPassage::factory()->create();
    $lacuna = Conjecture::factory()->for($passage, 'canonicalPassage')->lacuna()->create();

    $this->post(route('conjectures.store', $passage), [
        'type' => 'supplement',
        'text' => 'first guess',
        'supplements_conjecture_id' => $lacuna->id,
        'proposed_by' => 'Bentley',
    ]);
    $this->post(route('conjectures.store', $passage), [
        'type' => 'supplement',
        'text' => 'second guess',
        'supplements_conjecture_id' => $lacuna->id,
        'proposed_by' => 'Housman',
    ]);

    expect($lacuna->suppliedBy)->toHaveCount(2)
        ->and($lacuna->suppliedBy->pluck('proposed_by')->all())->toBe(['Bentley', 'Housman']);
});

test('a supplement needs to name which lacuna it fills', function () {
    $this->actingAs(User::factory()->editor()->create());
    $passage = CanonicalPassage::factory()->create();

    $response = $this->post(route('conjectures.store', $passage), [
        'type' => 'supplement',
        'text' => 'a guess',
    ]);

    $response->assertInvalid(['supplements_conjecture_id']);
    expect(Conjecture::count())->toBe(0);
});

test('a supplement cannot target a lacuna belonging to a different passage', function () {
    $this->actingAs(User::factory()->editor()->create());
    $passage = CanonicalPassage::factory()->create();
    $lacuna = Conjecture::factory()->lacuna()->create();

    $response = $this->post(route('conjectures.store', $passage), [
        'type' => 'supplement',
        'text' => 'a guess',
        'supplements_conjecture_id' => $lacuna->id,
    ]);

    $response->assertInvalid(['supplements_conjecture_id']);
});

test('a transposition cannot be recorded through the bare conjecture endpoint', function () {
    $this->actingAs(User::factory()->editor()->create());
    $passage = CanonicalPassage::factory()->create();

    $response = $this->post(route('conjectures.store', $passage), [
        'type' => 'transposition',
        'proposed_by' => 'Bentley',
    ]);

    $response->assertInvalid(['type']);
    expect(Conjecture::count())->toBe(0);
});
