<?php

use App\Models\Assignment;
use App\Models\Edition;
use App\Models\EditionComment;
use App\Models\Lemma;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\SegmentAdder;
use Illuminate\Support\Collection;
use Inertia\Testing\AssertableInertia as AssertInertia;

/**
 * A collated segment in an edition, ready to be commented on.
 *
 * @return array{work: Work, segment: Segment, edition: Edition, lemmas: Collection<int, Lemma>}
 */
function commentableEdition(string $text = 'the swift red fox'): array
{
    $work = Work::factory()->create();
    $segment = Segment::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1',
    ]);
    $edition = Edition::factory()->for($work)->create();

    $transcription = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'A']))
        ->create(['text' => $text]);
    $assignment = Assignment::factory()->for($transcription)->for($segment, 'segment')
        ->create(['start_offset' => 0, 'end_offset' => mb_strlen($text)]);

    SegmentAdder::add($edition, $assignment, 1.0);

    return [
        'work' => $work,
        'segment' => $segment,
        'edition' => $edition,
        'lemmas' => Lemma::where('segment_id', $segment->id)->orderBy('position')->get(),
    ];
}

test('an editor can note something about a whole segment', function () {
    // Speaker assignment is the motivating case: it belongs to the line, not
    // to any one word in it.
    $this->actingAs(User::factory()->editor()->create());
    ['segment' => $segment, 'edition' => $edition] = commentableEdition();

    $this->post(route('edition-comments.store', $edition), [
        'segment_id' => $segment->id,
        'note' => 'Assigned to Socrates; M gives it to Crito.',
    ])->assertRedirect()->assertSessionHasNoErrors();

    $comment = EditionComment::sole();

    expect($comment->note)->toBe('Assigned to Socrates; M gives it to Crito.')
        ->and($comment->lemma_id)->toBeNull()
        ->and($comment->edition_id)->toBe($edition->id);
});

test('a note can be anchored to a single column', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['segment' => $segment, 'edition' => $edition, 'lemmas' => $lemmas] = commentableEdition();

    $this->post(route('edition-comments.store', $edition), [
        'segment_id' => $segment->id,
        'lemma_id' => $lemmas[1]->id,
        'note' => 'M accents this as a proparoxytone; I print the paroxytone.',
    ])->assertRedirect()->assertSessionHasNoErrors();

    $comment = EditionComment::sole();

    // Single column: range_end stays null, the convention LemmaReading uses.
    expect($comment->lemma_id)->toBe($lemmas[1]->id)
        ->and($comment->range_end_lemma_id)->toBeNull();
});

test('a note can span a phrase', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['segment' => $segment, 'edition' => $edition, 'lemmas' => $lemmas] = commentableEdition();

    $this->post(route('edition-comments.store', $edition), [
        'segment_id' => $segment->id,
        'lemma_id' => $lemmas[1]->id,
        'range_end_lemma_id' => $lemmas[3]->id,
        'note' => 'Word division here follows M; N divides after the second word.',
    ])->assertRedirect()->assertSessionHasNoErrors();

    expect(EditionComment::sole()->range_end_lemma_id)->toBe($lemmas[3]->id);
});

test('a range end without a start is rejected', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['segment' => $segment, 'edition' => $edition, 'lemmas' => $lemmas] = commentableEdition();

    $this->post(route('edition-comments.store', $edition), [
        'segment_id' => $segment->id,
        'range_end_lemma_id' => $lemmas[2]->id,
        'note' => 'Dangling.',
    ])->assertInvalid(['lemma_id']);
});

test('a note cannot be anchored to a column of a different segment', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['segment' => $segment, 'edition' => $edition] = commentableEdition();
    $elsewhere = commentableEdition();

    $this->post(route('edition-comments.store', $edition), [
        'segment_id' => $segment->id,
        'lemma_id' => $elsewhere['lemmas'][0]->id,
        'note' => 'Wrong segment.',
    ])->assertInvalid(['lemma_id']);
});

test('a note cannot name a segment outside this edition\'s work', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition] = commentableEdition();
    $foreign = Segment::factory()->for(Work::factory()->create())->create();

    $this->post(route('edition-comments.store', $edition), [
        'segment_id' => $foreign->id,
        'note' => 'Wrong work.',
    ])->assertInvalid(['segment_id']);
});

test('notes reach the edition page with their author', function () {
    $author = User::factory()->editor()->create(['name' => 'R. Berge']);
    $this->actingAs($author);
    ['work' => $work, 'segment' => $segment, 'edition' => $edition, 'lemmas' => $lemmas] = commentableEdition();

    $this->post(route('edition-comments.store', $edition), [
        'segment_id' => $segment->id,
        'lemma_id' => $lemmas[1]->id,
        'note' => 'Breathing uncertain in M.',
    ]);

    $this->get(route('editions.show', [$work, $edition]))
        ->assertInertia(fn (AssertInertia $page) => $page
            ->has('windowSegments.0.comments', 1)
            ->where('windowSegments.0.comments.0.note', 'Breathing uncertain in M.')
            ->where('windowSegments.0.comments.0.author', 'R. Berge')
            ->where('windowSegments.0.comments.0.lemma_id', $lemmas[1]->id));
});

test('another edition of the same work does not see the note', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'segment' => $segment, 'edition' => $edition] = commentableEdition();

    $this->post(route('edition-comments.store', $edition), [
        'segment_id' => $segment->id,
        'note' => 'Mine alone.',
    ]);

    $other = Edition::factory()->for($work)->create();
    SegmentAdder::add($other, Assignment::where('segment_id', $segment->id)->sole(), 1.0);

    $this->get(route('editions.show', [$work, $other]))
        ->assertInertia(fn (AssertInertia $page) => $page->has('windowSegments.0.comments', 0));
});

test('a note can be reworded and removed', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['segment' => $segment, 'edition' => $edition] = commentableEdition();

    $this->post(route('edition-comments.store', $edition), [
        'segment_id' => $segment->id,
        'note' => 'First thoughts.',
    ]);

    $comment = EditionComment::sole();

    $this->patch(route('edition-comments.update', $comment), ['note' => 'On reflection.'])
        ->assertRedirect();
    expect($comment->fresh()->note)->toBe('On reflection.');

    $this->delete(route('edition-comments.destroy', $comment))->assertRedirect();
    expect(EditionComment::count())->toBe(0);
});

test('a guest can neither write nor remove a note', function () {
    ['segment' => $segment, 'edition' => $edition] = commentableEdition();

    // A signed-in reader without the editor role — an anonymous visitor is
    // redirected to login instead, see EnsureUserHasRole.
    $this->actingAs(User::factory()->create());

    $this->post(route('edition-comments.store', $edition), [
        'segment_id' => $segment->id,
        'note' => 'Not allowed.',
    ])->assertForbidden();

    expect(EditionComment::count())->toBe(0);
});

test('a note anchored to a column stops the collation being rebuilt', function () {
    // The editor chose that column to write about; a rebuild would move her
    // argument under her.
    $this->actingAs(User::factory()->editor()->create());
    ['segment' => $segment, 'edition' => $edition, 'lemmas' => $lemmas] = commentableEdition('the swift red fox');

    $this->post(route('edition-comments.store', $edition), [
        'segment_id' => $segment->id,
        'lemma_id' => $lemmas[1]->id,
        'note' => 'Anchored here.',
    ]);

    // "A" already seeded; this witness sorts first and would otherwise
    // trigger a rebuild.
    $earlier = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'AA']))
        ->create(['text' => 'the red fox']);
    SegmentAdder::add($edition, Assignment::factory()->for($earlier)->for($segment, 'segment')
        ->create(['start_offset' => 0, 'end_offset' => 11]), 2.0);

    expect(Lemma::whereKey($lemmas[1]->id)->exists())->toBeTrue()
        ->and(EditionComment::sole()->lemma_id)->toBe($lemmas[1]->id);
});

test('a segment-level note does not stop a rebuild, and survives one', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['segment' => $segment, 'edition' => $edition] = commentableEdition('the swift red fox');

    $this->post(route('edition-comments.store', $edition), [
        'segment_id' => $segment->id,
        'note' => 'About the line as a whole.',
    ]);

    $earlier = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'AA']))
        ->create(['text' => 'the red fox']);
    SegmentAdder::add($edition, Assignment::factory()->for($earlier)->for($segment, 'segment')
        ->create(['start_offset' => 0, 'end_offset' => 11]), 2.0);

    expect(EditionComment::sole()->note)->toBe('About the line as a whole.');
});
