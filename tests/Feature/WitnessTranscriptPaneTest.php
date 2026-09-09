<?php

use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\ManuscriptImage;
use App\Models\ManuscriptPage;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionPageBreak;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\PassageAdder;

/**
 * The `witnessTranscripts` prop behind the edition page's witnesses pane:
 * every visible layer of every witness, whole, with every citation.
 */

/**
 * A work whose two canonical passages are cited by one witness, with the
 * edition printing only the first. The transcript deliberately carries text
 * on both sides of the cited stretches, so a slice that failed to trim would
 * be obvious.
 *
 * @return array{work: Work, edition: Edition, witness: Witness, transcription: TranscriptionLayer, parent: Transcription}
 */
function citedTranscript(string $layer = 'normalized'): array
{
    $work = Work::factory()->create();
    $edition = Edition::factory()->for($work)->create();

    $first = CanonicalPassage::factory()->for($work)->create([
        'address' => ['line' => 1], 'sort_key' => '00000001', 'label' => '1',
    ]);
    $second = CanonicalPassage::factory()->for($work)->create([
        'address' => ['line' => 2], 'sort_key' => '00000002', 'label' => '2',
    ]);

    $witness = Witness::factory()->create(['siglum' => 'A']);
    $parent = Transcription::factory()->for($witness)->create();
    //                 0123456789...
    $text = 'XX alpha beta YY';
    $transcription = TranscriptionLayer::factory()->{$layer}()->for($parent)->published()
        ->create(['text' => $text]);

    $one = TranscriptionSegment::factory()->for($transcription)->for($first, 'canonicalPassage')
        ->create(['start_offset' => 3, 'end_offset' => 8]);
    TranscriptionSegment::factory()->for($transcription)->for($second, 'canonicalPassage')
        ->create(['start_offset' => 9, 'end_offset' => 13]);

    PassageAdder::add($edition, $one, 1.0);

    return compact('work', 'edition', 'witness', 'transcription', 'parent');
}

/**
 * @return array<int, array<string, mixed>>
 */
function witnessTranscripts(Work $work, Edition $edition): array
{
    return test()->get(route('editions.show', [$work, $edition]))
        ->viewData('page')['props']['witnessTranscripts'];
}

test('a transcript is sent whole, with every citation', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = citedTranscript();

    $pane = witnessTranscripts($work, $edition);

    // The pane is where segments are picked for the edition, so passage
    // 2 — not in the edition yet — must be there to pick.
    expect($pane)->toHaveCount(1)
        ->and($pane[0]['siglum'])->toBe('A')
        ->and($pane[0]['text'])->toBe('XX alpha beta YY')
        ->and(array_column($pane[0]['segments'], 'start_offset'))->toBe([3, 9])
        ->and($pane[0]['normalized_layer_id'])->toBe($pane[0]['id']);
});

test('a diplomatic entry names its normalized sibling, the layer an add draws on', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition, 'parent' => $parent, 'transcription' => $normalized] = citedTranscript();

    $passage = CanonicalPassage::where('work_id', $work->id)->orderBy('sort_key')->first();
    $diplomatic = TranscriptionLayer::factory()->diplomatic()->for($parent)->published()
        ->create(['text' => 'ΑΛΦΑ']);
    TranscriptionSegment::factory()->for($diplomatic)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 4]);

    $entry = collect(witnessTranscripts($work, $edition))->firstWhere('layer', 'diplomatic');

    expect($entry['normalized_layer_id'])->toBe($normalized->id)
        ->and($entry['segments'][0]['canonical_passage']['label'])->toBe('1');
});

test('a discontinuous citation ships its part ordinals and whole-layer totals', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition, 'transcription' => $transcription] = citedTranscript();

    // Passage 1 stands in a second place too — a transposition split it.
    // The badge must say "1 · 1/2" / "1 · 2/2", so the payload carries a
    // dense ordinal (raw `part` values can have gaps) and a whole-layer
    // total (the slice alone would undercount when a part sits off-window).
    $passage = CanonicalPassage::where('work_id', $work->id)->where('label', '1')->sole();
    TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 9, 'end_offset' => 13, 'part' => 5]);

    $pane = witnessTranscripts($work, $edition)[0];
    $ordinals = collect($pane['segments'])
        ->where('canonical_passage_id', $passage->id)
        ->map(fn (array $segment) => $segment['part_ordinal'])
        ->values()
        ->all();

    expect($ordinals)->toBe([1, 2])
        ->and($pane['part_totals'][$passage->id])->toBe(2);
});

test('both layers of a witness are offered', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition, 'parent' => $parent] = citedTranscript();

    $passage = CanonicalPassage::where('work_id', $work->id)->orderBy('sort_key')->first();
    $diplomatic = TranscriptionLayer::factory()->diplomatic()->for($parent)->published()
        ->create(['text' => 'ΑΛΦΑ']);
    TranscriptionSegment::factory()->for($diplomatic)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 4]);

    $pane = witnessTranscripts($work, $edition);

    // Diplomatic first: it is the manuscript itself, and the reason for
    // opening the pane.
    expect(array_column($pane, 'layer'))->toBe(['diplomatic', 'normalized'])
        ->and($pane[0]['text'])->toBe('ΑΛΦΑ');
});

test('a draft transcription stays out of the pane for a reader', function () {
    ['work' => $work, 'edition' => $edition] = citedTranscript();

    // Visibility belongs to the transcription, not to a layer, so a witness
    // still being worked on is hidden whole rather than layer by layer.
    $passage = CanonicalPassage::where('work_id', $work->id)->orderBy('sort_key')->first();
    $unfinished = Witness::factory()->create(['siglum' => 'Z']);
    $draft = Transcription::factory()->for($unfinished)->create(['visibility' => 'draft']);
    $layer = TranscriptionLayer::factory()->normalized()->for($draft)->create(['text' => 'ΑΛΦΑ']);
    TranscriptionSegment::factory()->for($layer)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 4]);

    $edition->update(['visibility' => 'published']);
    $this->actingAs(User::factory()->create());

    expect(array_column(witnessTranscripts($work, $edition), 'siglum'))->toBe(['A']);

    $this->actingAs(User::factory()->editor()->create());

    expect(array_column(witnessTranscripts($work, $edition), 'siglum'))->toBe(['A', 'Z']);
});

test('the edition box lists every visible witness citing the work, marking those the edition draws on', function () {
    ['work' => $work, 'edition' => $edition] = citedTranscript();

    // A second witness cites the work but the edition has taken nothing
    // from it yet — it must still appear, so an editor sees what is left.
    $passage = CanonicalPassage::where('work_id', $work->id)->orderBy('sort_key')->first();
    $unused = Witness::factory()->create(['siglum' => 'B', 'label' => 'Spare copy']);
    $spare = Transcription::factory()->for($unused)->create();
    $layer = TranscriptionLayer::factory()->normalized()->for($spare)->published()->create(['text' => 'ΑΛΦΑ']);
    TranscriptionSegment::factory()->for($layer)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 4]);

    // A witness of another work never shows, however visible.
    $elsewhere = CanonicalPassage::factory()->create();
    $foreign = Witness::factory()->create(['siglum' => 'C']);
    $foreignLayer = TranscriptionLayer::factory()->normalized()
        ->for(Transcription::factory()->for($foreign)->create())->published()->create(['text' => 'ΒΗΤΑ']);
    TranscriptionSegment::factory()->for($foreignLayer)->for($elsewhere, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 4]);

    $this->actingAs(User::factory()->editor()->create());

    $witnesses = $this->get(route('editions.show', [$work, $edition]))
        ->assertOk()
        ->viewData('page')['props']['witnesses'];

    expect(collect($witnesses)->map(fn (array $w) => [$w['siglum'], $w['in_edition']])->all())
        ->toBe([['A', true], ['B', false]])
        ->and($witnesses[1]['label'])->toBe('Spare copy');
});

test('a transcript ships its page breaks as offsets in its own text, and the witness\'s pages', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition, 'witness' => $witness, 'parent' => $parent, 'transcription' => $layer] = citedTranscript();
    $layer->update(['text' => "XX alpha\nbeta YY"]);

    $recto = ManuscriptPage::create(['witness_id' => $witness->id, 'label' => 'f. 1r', 'position' => 1]);
    $verso = ManuscriptPage::create(['witness_id' => $witness->id, 'label' => 'f. 1v', 'position' => 2]);
    TranscriptionPageBreak::create(['transcription_id' => $parent->id, 'manuscript_page_id' => $recto->id, 'start_line' => 0]);
    TranscriptionPageBreak::create(['transcription_id' => $parent->id, 'manuscript_page_id' => $verso->id, 'start_line' => 1]);

    $pane = witnessTranscripts($work, $edition)[0];

    expect(collect($pane['page_breaks'])->map(fn (array $break) => [$break['label'], $break['start_offset']])->all())
        ->toBe([['f. 1r', 0], ['f. 1v', 9]])
        ->and(collect($pane['pages'])->map(fn (array $page) => [$page['label'], $page['image']])->all())
        ->toBe([['f. 1r', null], ['f. 1v', null]]);
});

test('a transcript ships its image alignments, so the image view can light up lines and regions', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition, 'witness' => $witness, 'transcription' => $layer] = citedTranscript();
    $page = ManuscriptPage::create(['witness_id' => $witness->id, 'label' => 'f. 1r', 'position' => 1]);
    $image = ManuscriptImage::factory()->create(['witness_id' => $witness->id, 'manuscript_page_id' => $page->id]);
    TranscriptionRegion::factory()->create([
        'transcription_layer_id' => $layer->id,
        'manuscript_image_id' => $image->id,
        'start_offset' => 3,
        'end_offset' => 8,
    ]);

    $pane = witnessTranscripts($work, $edition)[0];

    expect($pane['regions'])->toHaveCount(1)
        ->and($pane['regions'][0]['manuscript_image_id'])->toBe($image->id)
        ->and([$pane['regions'][0]['start_offset'], $pane['regions'][0]['end_offset']])->toBe([3, 8])
        ->and($pane['pages'][0]['image']['id'])->toBe($image->id);
});
