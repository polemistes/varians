<?php

use App\Enums\ConjectureType;
use App\Enums\Layer;
use App\Enums\Visibility;
use App\Models\BibliographyItem;
use App\Models\BibliographyReference;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\ConjectureOrderingEntry;
use App\Models\Edition;
use App\Models\EditionComment;
use App\Models\EditionLemma;
use App\Models\EditionLineBreak;
use App\Models\EditionPassage;
use App\Models\EditionTransposition;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\ManuscriptImage;
use App\Models\ManuscriptImageFeature;
use App\Models\ManuscriptPage;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionPageBreak;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use Illuminate\Support\Facades\Storage;

/**
 * A published edition standing on everything an edition can stand on: two
 * passages; a witness with a page, a photograph, a feature on it, a
 * two-layer transcription citing both passages (with counterpart spans, an
 * image mapping and a page break) and a second transcription citing
 * nothing; a lacuna with a supplement and a reordering, cited from the
 * bibliography; a lemma with a witness reading and a conjectural one; and
 * the edition's passages, selection, line break, note, adoption and
 * passage citation.
 *
 * @return array<string, mixed>
 */
function publishedEditionGraph(): array
{
    Storage::fake('public');
    $owner = User::factory()->create();
    $work = Work::factory()->for($owner)->create(['slug' => 'iliad']);
    $p1 = CanonicalPassage::factory()->for($work)->create(['sort_key' => '0001', 'label' => '1']);
    $p2 = CanonicalPassage::factory()->for($work)->create(['sort_key' => '0002', 'label' => '2']);

    $witness = Witness::factory()->for($owner)->create(['siglum' => 'A']);
    $page = ManuscriptPage::factory()->create(['witness_id' => $witness->id, 'label' => '1r', 'position' => 1]);
    Storage::disk('public')->put('manuscript-images/original.jpg', 'jpeg bytes');
    $image = ManuscriptImage::factory()->create(['witness_id' => $witness->id, 'manuscript_page_id' => $page->id, 'path' => 'manuscript-images/original.jpg', 'position' => 1]);
    ManuscriptImageFeature::factory()->create(['manuscript_image_id' => $image->id, 'label' => 'Initial']);

    $transcription = Transcription::factory()->for($witness)->create(['visibility' => Visibility::Draft]);
    $diplomatic = TranscriptionLayer::factory()->for($transcription)->create(['layer' => Layer::Diplomatic, 'text' => 'the quick fox jumps', 'user_id' => $owner->id]);
    $normalized = TranscriptionLayer::factory()->for($transcription)->create(['layer' => Layer::Normalized, 'text' => 'the quick fox jumps', 'user_id' => $owner->id]);
    foreach ([$diplomatic, $normalized] as $layer) {
        TranscriptionSegment::factory()->for($layer)->for($p1, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 9, 'group_id' => 'group-1']);
        TranscriptionSegment::factory()->for($layer)->for($p2, 'canonicalPassage')->create(['start_offset' => 10, 'end_offset' => 19, 'group_id' => 'group-2']);
    }
    TranscriptionRegion::factory()->create(['transcription_layer_id' => $diplomatic->id, 'manuscript_image_id' => $image->id, 'text' => 'the', 'start_offset' => 0, 'end_offset' => 3, 'position' => 1, 'x' => 0.1, 'y' => 0.1, 'width' => 0.2, 'height' => 0.1, 'group_id' => 'region-1']);
    TranscriptionPageBreak::factory()->create(['transcription_id' => $transcription->id, 'manuscript_page_id' => $page->id, 'start_line' => 1]);

    $uncited = Transcription::factory()->for($witness)->create();
    TranscriptionLayer::factory()->for($uncited)->create(['text' => 'something else', 'user_id' => $owner->id]);

    $lacuna = Conjecture::factory()->for($owner)->for($p1, 'canonicalPassage')->create(['type' => ConjectureType::Lacuna, 'text' => null, 'visibility' => Visibility::Published]);
    $supplement = Conjecture::factory()->for($owner)->for($p1, 'canonicalPassage')->create(['type' => ConjectureType::Supplement, 'text' => 'slow', 'supplements_conjecture_id' => $lacuna->id, 'visibility' => Visibility::Published]);
    $reordering = Conjecture::factory()->for($owner)->for($p1, 'canonicalPassage')->create(['type' => ConjectureType::Reordering, 'text' => null, 'visibility' => Visibility::Published]);
    ConjectureOrderingEntry::factory()->create(['conjecture_id' => $reordering->id, 'canonical_passage_id' => $p2->id, 'sequence' => 1]);
    ConjectureOrderingEntry::factory()->create(['conjecture_id' => $reordering->id, 'canonical_passage_id' => $p1->id, 'sequence' => 2]);
    $item = BibliographyItem::factory()->create();
    BibliographyReference::factory()->create(['bibliography_item_id' => $item->id, 'conjecture_id' => $supplement->id, 'edition_id' => null, 'canonical_passage_id' => null]);

    $lemma = Lemma::factory()->create(['canonical_passage_id' => $p1->id, 'position' => 1]);
    $witnessReading = LemmaReading::factory()->create(['lemma_id' => $lemma->id, 'transcription_layer_id' => $normalized->id, 'start_offset' => 0, 'end_offset' => 9, 'conjecture_id' => null]);
    $conjecturalReading = LemmaReading::factory()->create(['lemma_id' => $lemma->id, 'transcription_layer_id' => null, 'start_offset' => null, 'end_offset' => null, 'conjecture_id' => $supplement->id]);

    $edition = Edition::factory()->for($owner)->for($work)->create(['title' => 'Editio maior', 'visibility' => Visibility::Published]);
    EditionPassage::factory()->create(['edition_id' => $edition->id, 'canonical_passage_id' => $p1->id, 'transcription_layer_id' => $normalized->id, 'position' => 1]);
    EditionPassage::factory()->create(['edition_id' => $edition->id, 'canonical_passage_id' => $p2->id, 'transcription_layer_id' => $normalized->id, 'position' => 2]);
    EditionLemma::factory()->create(['edition_id' => $edition->id, 'lemma_id' => $lemma->id, 'selected_reading_id' => $conjecturalReading->id]);
    EditionLineBreak::factory()->create(['edition_id' => $edition->id, 'canonical_passage_id' => $p1->id, 'lemma_id' => $lemma->id]);
    EditionComment::factory()->create(['edition_id' => $edition->id, 'canonical_passage_id' => $p1->id, 'lemma_id' => $lemma->id, 'user_id' => $owner->id, 'note' => 'A note']);
    EditionTransposition::factory()->create(['edition_id' => $edition->id, 'conjecture_id' => $reordering->id]);
    BibliographyReference::factory()->create(['bibliography_item_id' => $item->id, 'conjecture_id' => null, 'edition_id' => $edition->id, 'canonical_passage_id' => $p2->id]);
    $transcription->update(['visibility' => Visibility::Published]);

    return compact('owner', 'work', 'edition', 'witness', 'transcription', 'uncited', 'normalized', 'lacuna', 'supplement', 'reordering', 'lemma', 'conjecturalReading', 'item', 'image');
}

test('copying an edition redirects to the COPY, not to the original work under the copy\'s edition id', function () {
    // Real incident: replicate() carries over an already-loaded 'work'
    // relation, so the naive redirect landed on the original work's slug
    // paired with the copy's edition id — a combination EditionController::
    // show correctly 404s (abort_unless($work->is($edition->work))).
    $graph = publishedEditionGraph();
    $member = User::factory()->create();

    $response = $this->actingAs($member)->post(route('editions.copy', $graph['edition']));

    $copy = Edition::where('copied_from_id', $graph['edition']->id)->sole();
    $response->assertRedirect(route('editions.show', [$copy->work, $copy]));
    expect($copy->work->id)->not->toBe($graph['work']->id);

    $this->get($response->headers->get('Location'))->assertOk();
});

test('copying a public edition gives the member a work, witnesses, conjectures and collation of her own, mapped throughout', function () {
    $graph = publishedEditionGraph();
    $member = User::factory()->create();

    $this->actingAs($member)
        ->post(route('editions.copy', $graph['edition']))
        ->assertRedirect();

    $copy = Edition::where('copied_from_id', $graph['edition']->id)->sole();
    $work = $copy->work;

    expect($copy->user_id)->toBe($member->id)
        ->and($copy->visibility)->toBe(Visibility::Draft)
        ->and($copy->title)->toBe('Editio maior')
        ->and($work->id)->not->toBe($graph['work']->id)
        ->and($work->user_id)->toBe($member->id)
        ->and($work->copied_from_id)->toBe($graph['work']->id)
        ->and($work->slug)->toBe('iliad-copy')
        ->and($work->reference_scheme_id)->toBe($graph['work']->reference_scheme_id)
        ->and($work->canonicalPassages()->count())->toBe(2);

    // The witness, with only the transcription that cites the work.
    $witness = Witness::where('copied_from_id', $graph['witness']->id)->sole();
    expect($witness->user_id)->toBe($member->id)
        ->and($witness->siglum)->toBe('A')
        ->and($witness->pages()->count())->toBe(1)
        ->and($witness->images()->count())->toBe(1)
        ->and($witness->transcriptions()->count())->toBe(1);

    $image = $witness->images()->sole();
    expect($image->path)->not->toBe('manuscript-images/original.jpg')
        ->and(Storage::disk('public')->exists($image->path))->toBeTrue()
        ->and($image->features()->count())->toBe(1);

    $transcription = $witness->transcriptions()->sole();
    expect($transcription->visibility)->toBe(Visibility::Draft)
        ->and($transcription->layers()->count())->toBe(2)
        ->and($transcription->pageBreaks()->sole()->manuscript_page_id)->toBe($witness->pages()->sole()->id);

    $normalized = $transcription->layers()->where('layer', Layer::Normalized)->sole();
    expect($normalized->user_id)->toBe($member->id)
        ->and($normalized->copied_from_id)->toBe($graph['normalized']->id)
        ->and($normalized->segments()->count())->toBe(2)
        ->and($normalized->segments()->first()->canonicalPassage->work_id)->toBe($work->id)
        ->and($normalized->segments()->first()->group_id)->not->toBe('group-1')
        ->and($transcription->layers()->where('layer', Layer::Diplomatic)->sole()->regions()->sole()->manuscript_image_id)->toBe($image->id);

    // Counterparts still pair up: the two copies of a group share a fresh id.
    $groups = TranscriptionSegment::whereIn('transcription_layer_id', $transcription->layers()->pluck('id'))->pluck('group_id');
    expect($groups->unique()->count())->toBe(2)->and($groups->count())->toBe(4);

    // Conjectures, wired to the copied passages and to each other.
    $conjectures = Conjecture::whereIn('canonical_passage_id', $work->canonicalPassages()->pluck('id'))->get();
    expect($conjectures)->toHaveCount(3)
        ->and($conjectures->every(fn (Conjecture $conjecture) => $conjecture->user_id === $member->id && $conjecture->visibility === Visibility::Draft))->toBeTrue();
    $supplement = $conjectures->firstWhere('copied_from_id', $graph['supplement']->id);
    $lacuna = $conjectures->firstWhere('copied_from_id', $graph['lacuna']->id);
    $reordering = $conjectures->firstWhere('copied_from_id', $graph['reordering']->id);
    expect($supplement->supplements_conjecture_id)->toBe($lacuna->id)
        ->and($reordering->orderingEntries()->count())->toBe(2)
        ->and($reordering->orderingEntries()->first()->canonicalPassage->work_id)->toBe($work->id)
        ->and($supplement->references()->sole()->bibliography_item_id)->toBe($graph['item']->id);

    // The collation, and the edition's choices on it.
    $lemma = Lemma::whereIn('canonical_passage_id', $work->canonicalPassages()->pluck('id'))->sole();
    expect($lemma->readings()->count())->toBe(2)
        ->and($lemma->readings()->whereNotNull('transcription_layer_id')->sole()->transcription_layer_id)->toBe($normalized->id)
        ->and($lemma->readings()->whereNotNull('conjecture_id')->sole()->conjecture_id)->toBe($supplement->id);

    expect($copy->passages()->count())->toBe(2)
        ->and($copy->passages()->first()->transcription_layer_id)->toBe($normalized->id)
        ->and($copy->selections()->sole()->lemma_id)->toBe($lemma->id)
        ->and($copy->selections()->sole()->selected_reading_id)->toBe($lemma->readings()->whereNotNull('conjecture_id')->sole()->id)
        ->and(EditionLineBreak::where('edition_id', $copy->id)->sole()->lemma_id)->toBe($lemma->id)
        ->and($copy->comments()->sole()->lemma_id)->toBe($lemma->id)
        ->and($copy->transpositions()->sole()->conjecture_id)->toBe($reordering->id)
        ->and(BibliographyReference::where('edition_id', $copy->id)->sole()->canonical_passage_id)->toBe($work->canonicalPassages()->where('label', '2')->sole()->id);

    // Nothing in the copy points back at the original graph.
    expect($copy->editors()->count())->toBe(0)
        ->and(TranscriptionSegment::whereIn('transcription_layer_id', $transcription->layers()->pluck('id'))
            ->whereIn('canonical_passage_id', $graph['work']->canonicalPassages()->pluck('id'))->exists())->toBeFalse();
});

test('editing the copy leaves the original untouched, and vice versa', function () {
    $graph = publishedEditionGraph();
    $member = User::factory()->create();
    $this->actingAs($member)->post(route('editions.copy', $graph['edition']));
    $copy = Edition::where('copied_from_id', $graph['edition']->id)->sole();
    $copiedWitness = Witness::where('copied_from_id', $graph['witness']->id)->sole();

    $before = [
        'segments' => TranscriptionSegment::whereIn('transcription_layer_id', $graph['transcription']->layers()->pluck('id'))->count(),
        'lemmas' => Lemma::whereIn('canonical_passage_id', $graph['work']->canonicalPassages()->pluck('id'))->count(),
        'conjectures' => Conjecture::whereIn('canonical_passage_id', $graph['work']->canonicalPassages()->pluck('id'))->count(),
    ];

    $this->delete(route('witnesses.destroy', $copiedWitness))->assertRedirect();
    $this->delete(route('editions.destroy', $copy))->assertRedirect();
    $this->delete(route('works.destroy', $copy->work))->assertRedirect();

    expect(Witness::find($graph['witness']->id))->not->toBeNull()
        ->and(Edition::find($graph['edition']->id))->not->toBeNull()
        ->and(TranscriptionSegment::whereIn('transcription_layer_id', $graph['transcription']->layers()->pluck('id'))->count())->toBe($before['segments'])
        ->and(Lemma::whereIn('canonical_passage_id', $graph['work']->canonicalPassages()->pluck('id'))->count())->toBe($before['lemmas'])
        ->and(Conjecture::whereIn('canonical_passage_id', $graph['work']->canonicalPassages()->pluck('id'))->count())->toBe($before['conjectures'])
        ->and(Storage::disk('public')->exists('manuscript-images/original.jpg'))->toBeTrue();
});

test('a draft edition can be copied only by those who may edit it; a published one by any member', function () {
    $graph = publishedEditionGraph();
    $graph['edition']->update(['visibility' => Visibility::Draft]);
    $stranger = User::factory()->create();

    $this->actingAs($stranger)->post(route('editions.copy', $graph['edition']))->assertForbidden();
    $this->post(route('editions.copy', $graph['edition']))->assertForbidden();

    $this->actingAs($graph['owner'])->post(route('editions.copy', $graph['edition']))->assertRedirect();
    expect(Work::where('slug', 'iliad-copy')->exists())->toBeTrue();

    $graph['edition']->update(['visibility' => Visibility::Published]);
    $this->actingAs($stranger)->post(route('editions.copy', $graph['edition']))->assertRedirect();
    expect(Work::where('slug', 'iliad-copy-2')->sole()->user_id)->toBe($stranger->id);

    auth()->logout();
    $this->post(route('editions.copy', $graph['edition']))->assertRedirect(route('login'));
});

test('copying a public witness gives the member its pages, photographs and transcriptions, uncited', function () {
    $graph = publishedEditionGraph();
    $member = User::factory()->create();

    $this->actingAs($member)->post(route('witnesses.copy', $graph['witness']))->assertRedirect();

    // The published transcription comes along; the draft one nobody has
    // published stays with its owner.
    $copy = Witness::where('copied_from_id', $graph['witness']->id)->sole();
    expect($copy->user_id)->toBe($member->id)
        ->and($copy->pages()->count())->toBe(1)
        ->and($copy->images()->count())->toBe(1)
        ->and($copy->transcriptions()->count())->toBe(1)
        ->and($copy->transcriptionLayers()->count())->toBe(2)
        ->and($copy->transcriptions()->where('visibility', Visibility::Published)->exists())->toBeFalse()
        ->and(TranscriptionSegment::whereIn('transcription_layer_id', $copy->transcriptionLayers()->pluck('transcription_layers.id'))->exists())->toBeFalse()
        ->and(TranscriptionRegion::whereIn('transcription_layer_id', $copy->transcriptionLayers()->pluck('transcription_layers.id'))->count())->toBe(1);

    // A witness nobody has published is not there to copy.
    $private = Witness::factory()->create();
    Transcription::factory()->for($private)->create();
    $this->post(route('witnesses.copy', $private))->assertForbidden();
});

test('a copy carries only what the copier may see — no draft transcription, no unmapped photograph', function () {
    $graph = publishedEditionGraph();
    $owner = $graph['owner'];
    $work = $graph['work'];
    $p1 = $work->canonicalPassages()->where('label', '1')->sole();

    // A second transcription citing the work, kept as a draft after the
    // edition was published, with a reading in the collation.
    $draft = Transcription::factory()->for($graph['witness'])->create(['visibility' => Visibility::Draft]);
    $draftLayer = TranscriptionLayer::factory()->for($draft)->create(['layer' => Layer::Normalized, 'text' => 'the quick fox', 'user_id' => $owner->id]);
    TranscriptionSegment::factory()->for($draftLayer)->for($p1, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 9]);
    LemmaReading::factory()->create(['lemma_id' => $graph['lemma']->id, 'transcription_layer_id' => $draftLayer->id, 'start_offset' => 0, 'end_offset' => 9, 'conjecture_id' => null]);

    // A photograph of a page nothing published maps to.
    $page2 = ManuscriptPage::factory()->create(['witness_id' => $graph['witness']->id, 'label' => '1v', 'position' => 2]);
    ManuscriptImage::factory()->create(['witness_id' => $graph['witness']->id, 'manuscript_page_id' => $page2->id, 'path' => 'manuscript-images/unmapped.jpg', 'position' => 2]);

    $stranger = User::factory()->create();
    $this->actingAs($stranger)->post(route('editions.copy', $graph['edition']))->assertRedirect();

    $witness = Witness::where('copied_from_id', $graph['witness']->id)->sole();
    $lemma = Lemma::whereIn('canonical_passage_id', Work::where('copied_from_id', $work->id)->sole()->canonicalPassages()->pluck('id'))->sole();

    expect($witness->transcriptions()->count())->toBe(1)
        ->and($witness->pages()->count())->toBe(2)
        ->and($witness->images()->count())->toBe(1)
        ->and($lemma->readings()->count())->toBe(2);

    // The owner copying her own edition gets everything.
    $this->actingAs($owner)->post(route('editions.copy', $graph['edition']))->assertRedirect();
    $ownCopy = Witness::where('copied_from_id', $graph['witness']->id)->where('user_id', $owner->id)->sole();
    expect($ownCopy->transcriptions()->count())->toBe(2)
        ->and($ownCopy->images()->count())->toBe(2);
});

test('a witness whose transcriptions the copier may not read is left out, not copied as an empty siglum', function () {
    $graph = publishedEditionGraph();
    $work = $graph['work'];
    $p1 = $work->canonicalPassages()->where('label', '1')->sole();

    // A second witness citing the work, whose only transcription is a draft.
    $hidden = Witness::factory()->for($graph['owner'])->create(['siglum' => 'Z']);
    $draft = Transcription::factory()->for($hidden)->create(['visibility' => Visibility::Draft]);
    $draftLayer = TranscriptionLayer::factory()->for($draft)->create(['layer' => Layer::Normalized, 'text' => 'the quick fox', 'user_id' => $graph['owner']->id]);
    TranscriptionSegment::factory()->for($draftLayer)->for($p1, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 9]);

    $this->actingAs(User::factory()->create())->post(route('editions.copy', $graph['edition']))->assertRedirect();

    expect(Witness::where('copied_from_id', $hidden->id)->exists())->toBeFalse()
        ->and(Witness::where('copied_from_id', $graph['witness']->id)->exists())->toBeTrue();

    // Her owner copying it gets both, since she may read both.
    $this->actingAs($graph['owner'])->post(route('editions.copy', $graph['edition']))->assertRedirect();
    expect(Witness::where('copied_from_id', $hidden->id)->where('user_id', $graph['owner']->id)->sole()
        ->transcriptions()->count())->toBe(1);
});
