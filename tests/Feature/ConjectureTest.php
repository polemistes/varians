<?php

use App\Enums\ConjectureType;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\EditionTransposition;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\User;
use App\Models\Work;
use Inertia\Testing\AssertableInertia;

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
    ]);

    $conjecture = Conjecture::sole();
    expect($conjecture->proposed_by)->toBe('Bentley')
        ->and($conjecture->user_id)->toBe($editor->id);
});

test('proposed_by is optional', function () {
    $this->actingAs(User::factory()->editor()->create());
    $passage = CanonicalPassage::factory()->create();

    $response = $this->post(route('conjectures.store', $passage), ['text' => 'reading']);

    $response->assertRedirect();
    $conjecture = Conjecture::sole();
    expect($conjecture->proposed_by)->toBeNull();
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

test('a transposition can be catalogued for a work without applying it to any edition', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();
    [$start, $end, $target] = CanonicalPassage::factory()->for($work)->count(3)->sequence(
        ['sort_key' => '00000001', 'label' => '1'],
        ['sort_key' => '00000002', 'label' => '2'],
        ['sort_key' => '00000003', 'label' => '3'],
    )->create();

    $this->post(route('conjectures.store', $start), [
        'type' => 'transposition',
        'transposition_range_end_canonical_passage_id' => $end->id,
        'move_target_canonical_passage_id' => $target->id,
        'move_position' => 'after',
        'proposed_by' => 'Bentley',
    ])->assertRedirect();

    $conjecture = Conjecture::sole();
    expect($conjecture->type)->toBe(ConjectureType::Transposition)
        ->and($conjecture->move_target_canonical_passage_id)->toBe($target->id)
        ->and($conjecture->move_position)->toBe('after')
        ->and(EditionTransposition::count())->toBe(0);

    // The target may not lie inside the moved range.
    $this->post(route('conjectures.store', $start), [
        'type' => 'transposition',
        'transposition_range_end_canonical_passage_id' => $target->id,
        'move_target_canonical_passage_id' => $end->id,
        'move_position' => 'after',
    ])->assertInvalid(['move_target_canonical_passage_id']);
});

test('a reordering can be catalogued for a contiguous stretch, hanging from its first passage', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();
    [$one, $two, $three] = CanonicalPassage::factory()->for($work)->count(3)->sequence(
        ['sort_key' => '00000001', 'label' => '1'],
        ['sort_key' => '00000002', 'label' => '2'],
        ['sort_key' => '00000003', 'label' => '3'],
    )->create();

    $this->post(route('conjectures.store', $two), [
        'type' => 'reordering',
        'canonical_passage_ids' => [$three->id, $one->id, $two->id],
        'proposed_by' => 'Bergk',
    ])->assertRedirect();

    $conjecture = Conjecture::sole();
    expect($conjecture->type)->toBe(ConjectureType::Reordering)
        ->and($conjecture->canonical_passage_id)->toBe($one->id)
        ->and($conjecture->orderingEntries()->orderBy('sequence')->pluck('canonical_passage_id')->all())->toBe([$three->id, $one->id, $two->id]);

    $this->post(route('conjectures.store', $one), [
        'type' => 'reordering',
        'canonical_passage_ids' => [$three->id, $one->id],
    ])->assertInvalid(['canonical_passage_ids']);
});

test('editing keeps the record consistent with its kind, and a placed conjecture cannot change kind', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();
    [$one, $two, $three] = CanonicalPassage::factory()->for($work)->count(3)->sequence(
        ['sort_key' => '00000001', 'label' => '1'],
        ['sort_key' => '00000002', 'label' => '2'],
        ['sort_key' => '00000003', 'label' => '3'],
    )->create();
    $conjecture = Conjecture::factory()->for($one, 'canonicalPassage')->create(['type' => ConjectureType::Substitution, 'text' => 'verbum']);

    // A substitution cannot lose its text...
    $this->patch(route('conjectures.update', $conjecture), ['text' => ''])->assertInvalid(['text']);

    // ...but may become a reordering, which replaces its fields with a sequence.
    $this->patch(route('conjectures.update', $conjecture), [
        'type' => 'reordering',
        'canonical_passage_ids' => [$two->id, $one->id, $three->id],
    ])->assertRedirect();

    $conjecture->refresh();
    expect($conjecture->type)->toBe(ConjectureType::Reordering)
        ->and($conjecture->text)->toBeNull()
        ->and($conjecture->orderingEntries()->count())->toBe(3);

    // Placed in an edition, its kind is fixed.
    $placed = Conjecture::factory()->for($one, 'canonicalPassage')->create(['type' => ConjectureType::Substitution, 'text' => 'aliud']);
    LemmaReading::factory()->create(['conjecture_id' => $placed->id, 'transcription_layer_id' => null, 'start_offset' => null, 'end_offset' => null, 'lemma_id' => Lemma::factory()->for($one, 'canonicalPassage')->create()->id]);

    $this->patch(route('conjectures.update', $placed), ['type' => 'lacuna', 'text' => ''])->assertInvalid(['type']);
});

test('the work page lists every conjecture with where it is in use', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create(['label' => '7']);
    $conjecture = Conjecture::factory()->for($passage, 'canonicalPassage')->create(['type' => ConjectureType::Substitution, 'text' => 'verbum', 'proposed_by' => 'Dover']);

    $this->get(route('works.show', $work))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->has('conjectures', 1)
            ->where('conjectures.0.id', $conjecture->id)
            ->where('conjectures.0.passage_label', '7')
            ->where('conjectures.0.proposed_by', 'Dover')
            ->where('conjectures.0.placed', false)
            ->where('conjectures.0.deletion_impact.readings', 0)
            ->has('referenceLevels')
            ->has('bibliographyForm.registry'));
});
