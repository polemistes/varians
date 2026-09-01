<?php

use App\Enums\WitnessType;
use App\Models\CanonicalPassage;
use App\Models\Manuscript;
use App\Models\ManuscriptImage;
use App\Models\ManuscriptPage;
use App\Models\ReferenceScheme;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use Illuminate\Database\QueryException;

test('a work belongs to a reference scheme and has canonical passages', function () {
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $passage = CanonicalPassage::factory()->for($work)->create();

    expect($work->referenceScheme->is($scheme))->toBeTrue()
        ->and($work->canonicalPassages->first()->is($passage))->toBeTrue();
});

test('a manuscript witness has ordered images', function () {
    $witness = Witness::factory()->create(['type' => WitnessType::Manuscript]);
    $manuscript = Manuscript::factory()->for($witness)->create();
    ManuscriptImage::factory()->for($manuscript)
        ->for(ManuscriptPage::factory()->for($manuscript)->create(['label' => '2r']), 'manuscriptPage')
        ->create(['position' => 2]);
    ManuscriptImage::factory()->for($manuscript)
        ->for(ManuscriptPage::factory()->for($manuscript)->create(['label' => '1v']), 'manuscriptPage')
        ->create(['position' => 1]);

    expect($manuscript->images()->orderBy('position')->with('manuscriptPage')->get()
        ->map(fn ($image) => $image->manuscriptPage->label)->all())
        ->toBe(['1v', '2r']);
});

test('transcription segment order can diverge from canonical passage order', function () {
    $work = Work::factory()->create();
    $witness = Witness::factory()->create(['type' => WitnessType::Manuscript]);

    $line976 = CanonicalPassage::factory()->for($work)->create(['address' => ['line' => 976], 'sort_key' => '00000976', 'label' => '976']);
    $line1000 = CanonicalPassage::factory()->for($work)->create(['address' => ['line' => 1000], 'sort_key' => '00001000', 'label' => '1000']);
    $line977 = CanonicalPassage::factory()->for($work)->create(['address' => ['line' => 977], 'sort_key' => '00000977', 'label' => '977']);

    // In this witness, line 1000 physically appears between 976 and 977.
    $lines = ['nine seven six', 'one thousand', 'nine seven seven'];
    $transcription = TranscriptionLayer::factory()
        ->for($witness)
        ->for(User::factory(), 'user')
        ->create(['text' => implode("\n", $lines)]);

    $offset = 0;

    foreach ([$line976, $line1000, $line977] as $index => $passage) {
        $length = mb_strlen($lines[$index]);

        TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')->create([
            'start_offset' => $offset,
            'end_offset' => $offset + $length,
        ]);

        $offset += $length + 1;
    }

    $physicalOrder = $transcription->segments()->orderBy('start_offset')->with('canonicalPassage')->get()
        ->map(fn (TranscriptionSegment $segment) => $segment->canonicalPassage->label)
        ->all();

    $citationOrder = $work->canonicalPassages()->orderBy('sort_key')->pluck('label')->all();

    expect($physicalOrder)->toBe(['976', '1000', '977'])
        ->and($citationOrder)->toBe(['976', '977', '1000']);
});

test('a transcription layer can be copied', function () {
    $original = TranscriptionLayer::factory()->create();
    $fork = TranscriptionLayer::factory()->create(['copied_from_id' => $original->id]);

    expect($fork->copiedFrom->is($original))->toBeTrue()
        ->and($original->copies->first()->is($fork))->toBeTrue();
});

test('a transcription can have two separate spans citing the same canonical passage', function () {
    // e.g. a passage quoted twice, or split across a marginal interruption —
    // segments are independent offset spans, not one-per-passage slots.
    $transcription = TranscriptionLayer::factory()->create();
    $passage = CanonicalPassage::factory()->create();

    TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 5]);
    TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 10, 'end_offset' => 15]);

    expect($transcription->segments()->where('canonical_passage_id', $passage->id)->count())->toBe(2);
});

test('a segment always requires a canonical passage', function () {
    TranscriptionSegment::factory()->create(['canonical_passage_id' => null]);
})->throws(QueryException::class);
