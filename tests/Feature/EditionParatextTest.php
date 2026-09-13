<?php

use App\Enums\SpeakerDisplay;
use App\Models\Assignment;
use App\Models\Edition;
use App\Models\EditionParatext;
use App\Models\Lemma;
use App\Models\ReferenceScheme;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Copying\EditionCopier;
use App\Support\Edition\SegmentAdder;
use App\Support\Edition\SegmentAligner;
use Illuminate\Support\Collection;
use Inertia\Testing\AssertableInertia;

/**
 * Paratext: what an edition prints beside or among the words without its
 * being text of the work — see App\Models\EditionParatext. It has a place
 * in the text (before or after one column) and nothing else: no reading,
 * no apparatus, no collation.
 *
 * @return array{work: Work, edition: Edition, segment: Segment, lemmas: Collection<int, Lemma>}
 */
function paratextEdition(string $text = 'the quick fox'): array
{
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $segment = Segment::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1']);
    $base = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'A']))->create(['text' => $text]);
    $assignment = Assignment::factory()->for($base)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => mb_strlen($text)]);
    SegmentAdder::add($edition, $assignment, 1.0);

    return [
        'work' => $work,
        'edition' => $edition,
        'segment' => $segment,
        'lemmas' => Lemma::where('segment_id', $segment->id)->orderBy('position')->get()->toBase(),
    ];
}

test('an editor adds a paratext before a column, and the page prints it at that run', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'segment' => $segment, 'lemmas' => $lemmas] = paratextEdition();

    $this->post(route('edition-paratexts.store', $edition), [
        'segment_id' => $segment->id,
        'lemma_id' => $lemmas[1]->id,
        'placement' => 'before',
        'kind' => 'speaker',
        'text' => 'ΧΟ.',
    ])->assertRedirect()->assertSessionHasNoErrors();

    $this->get(route('editions.show', [$work, $edition]))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('windowSegments.0.paratexts.0.run_index', 1)
            ->where('windowSegments.0.paratexts.0.placement', 'before')
            ->where('windowSegments.0.paratexts.0.kind', 'speaker')
            ->where('windowSegments.0.paratexts.0.text', 'ΧΟ.')
            ->where('edition.speaker_display', 'inline'));
});

test('several paratexts at one point read in the order they were added', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'segment' => $segment, 'lemmas' => $lemmas] = paratextEdition();

    foreach (['first', 'second'] as $text) {
        $this->post(route('edition-paratexts.store', $edition), [
            'segment_id' => $segment->id,
            'lemma_id' => $lemmas[2]->id,
            'placement' => 'after',
            'kind' => 'right_margin',
            'text' => $text,
        ])->assertSessionHasNoErrors();
    }

    expect($edition->paratexts()->orderBy('position')->pluck('text')->all())->toBe(['first', 'second'])
        ->and($edition->paratexts()->orderBy('position')->pluck('position')->all())->toBe([1, 2]);
});

test('a paratext must name a column of a segment of the edition\'s own work', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'segment' => $segment] = paratextEdition();
    $foreign = Lemma::factory()->create();

    $this->post(route('edition-paratexts.store', $edition), [
        'segment_id' => $segment->id,
        'lemma_id' => $foreign->id,
        'placement' => 'before',
        'kind' => 'inline',
        'text' => 'x',
    ])->assertSessionHasErrors('lemma_id');
});

test('a paratext can be reworded and removed by whoever may edit the edition, and by nobody else', function () {
    $owner = User::factory()->create();
    ['edition' => $edition, 'segment' => $segment, 'lemmas' => $lemmas] = paratextEdition();
    $edition->update(['user_id' => $owner->id]);
    $paratext = EditionParatext::factory()->create([
        'edition_id' => $edition->id, 'segment_id' => $segment->id, 'lemma_id' => $lemmas[0]->id, 'text' => 'old',
    ]);

    $this->actingAs(User::factory()->create())
        ->patch(route('edition-paratexts.update', $paratext), ['text' => 'theirs'])
        ->assertForbidden();

    $this->actingAs($owner)
        ->patch(route('edition-paratexts.update', $paratext), ['text' => 'new', 'kind' => 'left_margin'])
        ->assertRedirect()->assertSessionHasNoErrors();

    expect($paratext->fresh()->text)->toBe('new')
        ->and($paratext->fresh()->kind->value)->toBe('left_margin');

    $this->actingAs($owner)->delete(route('edition-paratexts.destroy', $paratext))->assertRedirect();

    expect(EditionParatext::whereKey($paratext->id)->exists())->toBeFalse();
});

test('how speaker indications are set is one choice for the whole edition', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition] = paratextEdition();

    $this->patch(route('editions.update', $edition), ['speaker_display' => 'own_line_centered'])
        ->assertRedirect()->assertSessionHasNoErrors();

    expect($edition->fresh()->speaker_display)->toBe(SpeakerDisplay::OwnLineCentered);

    $this->patch(route('editions.update', $edition), ['speaker_display' => 'sideways'])
        ->assertSessionHasErrors('speaker_display');
});

test('a paratext pins its column: the segment\'s collation is not rebuilt under it', function () {
    ['edition' => $edition, 'segment' => $segment, 'lemmas' => $lemmas] = paratextEdition();
    EditionParatext::factory()->create([
        'edition_id' => $edition->id, 'segment_id' => $segment->id, 'lemma_id' => $lemmas[1]->id,
    ]);
    $layer = $lemmas[0]->readings()->first()->transcriptionLayer;

    // A rebuild would delete the column the paratext stands at; it is
    // refused instead, exactly as for a line break.
    expect(SegmentAligner::realignLayer($segment, $layer))->toBeFalse()
        ->and(Lemma::whereKey($lemmas[1]->id)->exists())->toBeTrue();
});

test('removing the segment from the edition removes its paratexts with it', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'segment' => $segment, 'lemmas' => $lemmas] = paratextEdition();
    EditionParatext::factory()->create([
        'edition_id' => $edition->id, 'segment_id' => $segment->id, 'lemma_id' => $lemmas[0]->id,
    ]);

    $this->delete(route('edition-segments.destroy', $edition), ['segment_ids' => [$segment->id]])
        ->assertRedirect();

    expect($edition->paratexts()->count())->toBe(0)
        ->and(Lemma::whereKey($lemmas[0]->id)->exists())->toBeTrue();
});

test('a copied edition carries its paratexts and its speaker layout', function () {
    ['edition' => $edition, 'segment' => $segment, 'lemmas' => $lemmas] = paratextEdition();
    $edition->update(['visibility' => 'published', 'speaker_display' => SpeakerDisplay::OwnLine]);
    // A copy carries only what the copier may see: the witness's transcription must be public.
    $lemmas[0]->readings()->first()->transcriptionLayer->transcription->update(['visibility' => 'published']);
    EditionParatext::factory()->create([
        'edition_id' => $edition->id, 'segment_id' => $segment->id, 'lemma_id' => $lemmas[2]->id, 'text' => 'ΧΟ.', 'placement' => 'after',
    ]);
    $copier = User::factory()->create();

    $copy = EditionCopier::copy($edition, $copier);

    $copied = $copy->paratexts()->sole();

    expect($copied->text)->toBe('ΧΟ.')
        ->and($copied->placement)->toBe('after')
        ->and($copied->segment_id)->not->toBe($segment->id)
        ->and($copied->lemma->segment_id)->toBe($copied->segment_id)
        ->and($copy->speaker_display)->toBe(SpeakerDisplay::OwnLine);
});
