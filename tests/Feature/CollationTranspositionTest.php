<?php

use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\Transcription;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\PassageAdder;
use Normalizer;

/**
 * Collate one passage from the given witnesses and return both the columns
 * and each edition-eye view of the text.
 *
 * @param  array<string, string>  $texts  siglum => text
 * @return array{columns: list<list<string>>, printed: array<string, string>}
 */
function collationOf(array $texts): array
{
    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1',
    ]);

    $editions = [];
    $position = 1.0;

    foreach ($texts as $siglum => $text) {
        $transcription = Transcription::factory()
            ->for(Witness::factory()->create(['siglum' => $siglum]))
            ->create(['text' => $text]);
        $segment = TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
            ->create(['start_offset' => 0, 'end_offset' => mb_strlen($text)]);

        $edition = Edition::factory()->for($work)->create(['title' => "Based on {$siglum}"]);
        PassageAdder::add($edition, $segment, $position++);
        $editions[$siglum] = $edition;
    }

    $columns = Lemma::where('canonical_passage_id', $passage->id)
        ->orderBy('position')
        ->with('readings.transcription.witness')
        ->get()
        ->map(fn (Lemma $lemma) => $lemma->readings
            ->map(fn (LemmaReading $reading) => $reading->transcription->witness->siglum.':'.mb_substr(
                $reading->transcription->text,
                $reading->start_offset,
                $reading->end_offset - $reading->start_offset,
            ))
            ->sort()->values()->all())
        ->values()->all();

    $printed = [];

    foreach ($editions as $siglum => $edition) {
        $runs = test()->get(route('editions.show', [$work, $edition]))
            ->viewData('page')['props']['windowPassages'][0]['runs'];
        // Skip gap runs — a column the base omits contributes no words.
        $printed[$siglum] = implode(' ', array_filter(array_column($runs, 'text'), fn (string $t) => $t !== ''));
    }

    return ['columns' => $columns, 'printed' => $printed];
}

test('a swapped pair becomes one variant site, not two single-witness columns', function () {
    // Left to plain LCS this is a delete of "swift" in one place and an
    // insert of it in another, which the apparatus would report as one
    // manuscript omitting a word and adding it again elsewhere.
    $this->actingAs(User::factory()->editor()->create());

    $result = collationOf(['A' => 'the swift red fox', 'B' => 'the red swift fox']);

    // "swift" appears once as a column, not twice.
    expect($result['columns'])->toHaveCount(4);

    // One site carries both witnesses' orderings against each other.
    expect($result['columns'][1])->toBe(['A:swift', 'B:red swift']);
});

test('each edition still prints its own witness in its own order', function () {
    $this->actingAs(User::factory()->editor()->create());

    $result = collationOf(['A' => 'the swift red fox', 'B' => 'the red swift fox']);

    expect($result['printed']['A'])->toBe('the swift red fox')
        ->and($result['printed']['B'])->toBe('the red swift fox');
});

test('a moved block of several words is one site too', function () {
    $this->actingAs(User::factory()->editor()->create());

    $result = collationOf(['A' => 'alpha beta gamma delta', 'B' => 'gamma delta alpha beta']);

    expect($result['columns'][0])->toBe(['A:alpha', 'B:gamma delta alpha beta'])
        ->and($result['printed']['A'])->toBe('alpha beta gamma delta')
        ->and($result['printed']['B'])->toBe('gamma delta alpha beta');
});

test('a word moved across untouched words is still recognised', function () {
    $this->actingAs(User::factory()->editor()->create());

    $result = collationOf(['A' => 'a b c d e', 'B' => 'a c d b e']);

    expect($result['columns'][1])->toBe(['A:b', 'B:c d b'])
        ->and($result['printed']['B'])->toBe('a c d b e');
});

test('a genuine substitution is not mistaken for a transposition', function () {
    $this->actingAs(User::factory()->editor()->create());

    $result = collationOf(['A' => 'the swift fox', 'B' => 'the slow fox']);

    expect($result['columns'])->toBe([
        ['A:the', 'B:the'],
        ['A:swift', 'B:slow'],
        ['A:fox', 'B:fox'],
    ]);
});

test('an omission is not mistaken for a transposition', function () {
    $this->actingAs(User::factory()->editor()->create());

    $result = collationOf(['A' => 'the swift red fox', 'B' => 'the red fox']);

    // "swift" is attested by A alone — absence is the gap, as before.
    expect($result['columns'][1])->toBe(['A:swift'])
        ->and($result['printed']['B'])->toBe('the red fox');
});

test('an addition is not mistaken for a transposition', function () {
    $this->actingAs(User::factory()->editor()->create());

    $result = collationOf(['A' => 'the red fox', 'B' => 'the swift red fox']);

    expect($result['columns'][1])->toBe(['B:swift'])
        ->and($result['printed']['A'])->toBe('the red fox');
});

test('the same word encoded differently in Unicode collates as one word', function () {
    // Precomposed against decomposed Greek: indistinguishable on screen,
    // unequal as strings. Pasting two witnesses from sources that use
    // different encodings used to make every word differ, collapsing the
    // whole line into one spurious variant.
    $this->actingAs(User::factory()->editor()->create());

    $nfc = Normalizer::normalize('τοσοῦτοι μὲν οὖν', Normalizer::FORM_C);
    $nfd = Normalizer::normalize('τοσοῦτοι μὲν οὖν', Normalizer::FORM_D);

    expect($nfc)->not->toBe($nfd); // genuinely different strings

    $result = collationOf(['A' => $nfc, 'B' => $nfd]);

    // Three columns, each attested by both witnesses — no variants at all.
    expect($result['columns'])->toHaveCount(3);

    foreach ($result['columns'] as $column) {
        expect($column)->toHaveCount(2);
    }
});

test('storage keeps the encoding the editor typed', function () {
    // Comparison normalizes; storage must not, or every character offset
    // recorded against the text would shift under it.
    $this->actingAs(User::factory()->editor()->create());

    $nfd = Normalizer::normalize('τοσοῦτοι μὲν οὖν', Normalizer::FORM_D);
    collationOf(['A' => $nfd]);

    expect(Transcription::whereNotNull('text')->first()->text)->toBe($nfd);
});
