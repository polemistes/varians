<?php

use App\Enums\Layer;
use App\Models\Assignment;
use App\Models\Edition;
use App\Models\ReferenceScheme;
use App\Models\Segment;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\SegmentAdder;
use Illuminate\Support\Facades\DB;

/**
 * The edition page's query count must not grow with the number of words:
 * every word and every candidate consults the diplomatic counterpart,
 * which reads the layers' assignments, and unloaded they cost a query
 * each (real incident: 1056 queries and 5.8 s on one page in production).
 * Loaded once per layer, more segments add a handful of queries at most.
 *
 * @return array{work: Work, edition: Edition}
 */
function editionOfLines(int $lines): array
{
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $text = implode("\n", array_map(fn (int $line) => "word{$line} other{$line} third{$line}", range(1, $lines)));
    $layers = [];

    foreach (['A', 'B'] as $siglum) {
        $transcription = Transcription::factory()->for(Witness::factory()->create(['siglum' => $siglum]))
            ->create(['visibility' => 'published']);
        TranscriptionLayer::factory()->for($transcription)->create(['layer' => Layer::Diplomatic, 'text' => mb_strtoupper($text)]);
        $layers[$siglum] = TranscriptionLayer::factory()->for($transcription)->create(['layer' => Layer::Normalized, 'text' => $text]);
    }

    $offset = 0;

    for ($line = 1; $line <= $lines; $line++) {
        $segment = Segment::factory()->for($work)->create([
            'address' => ['book' => 1, 'line' => $line],
            'sort_key' => sprintf('00000001.%08d', $line),
            'label' => "1.{$line}",
        ]);
        $length = mb_strlen("word{$line} other{$line} third{$line}");

        foreach ($layers as $layer) {
            Assignment::factory()->for($layer)->for($segment, 'segment')
                ->create(['start_offset' => $offset, 'end_offset' => $offset + $length]);
        }

        $offset += $length + 1;
    }

    $base = Assignment::where('transcription_layer_id', $layers['A']->id)->orderBy('start_offset')->get();

    foreach ($base as $index => $assignment) {
        SegmentAdder::add($edition, $assignment, $index + 1.0);
    }

    return compact('work', 'edition');
}

function queriesToShow(Work $work, Edition $edition): int
{
    DB::flushQueryLog();
    DB::enableQueryLog();
    test()->get(route('editions.show', [$work, $edition]))->assertOk();
    $count = count(DB::getQueryLog());
    DB::disableQueryLog();

    return $count;
}

test('the edition page runs a bounded number of queries, whatever the number of words', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $small, 'edition' => $smallEdition] = editionOfLines(2);
    ['work' => $large, 'edition' => $largeEdition] = editionOfLines(10);

    $few = queriesToShow($small, $smallEdition);
    $many = queriesToShow($large, $largeEdition);

    // Eight more lines of three words in two witnesses: a few more
    // queries for the extra rows, never one per word.
    expect($many - $few)->toBeLessThanOrEqual(12)
        ->and($many)->toBeLessThan(120);
});
