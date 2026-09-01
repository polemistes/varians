<?php

use App\Models\Manuscript;
use App\Models\ManuscriptImage;
use App\Models\ManuscriptPage;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionPageBreak;
use App\Models\User;
use Illuminate\Database\QueryException;

/**
 * Pages exist in their own right, and a layer's text is divided onto them by
 * breakpoints — one offset per page, the page running to the next break.
 */
test('a page can be recorded before anyone has photographed it', function () {
    $manuscript = Manuscript::factory()->create();

    $page = $manuscript->pages()->create(['label' => 'f. 12r', 'position' => 1]);

    // The case the old model could not express at all, since a page *was* an
    // image and `path` is NOT NULL. A transcription made from a printed
    // facsimile or the manuscript itself still has pages to divide text onto.
    expect($page->images)->toBeEmpty()
        ->and($manuscript->pages()->count())->toBe(1);
});

test('an image is a photograph of a page, and takes its label from it', function () {
    $manuscript = Manuscript::factory()->create();
    $page = ManuscriptPage::factory()->for($manuscript)->create(['label' => '12v']);

    $image = ManuscriptImage::factory()->for($manuscript)->for($page, 'manuscriptPage')->create();

    expect($image->manuscriptPage->label)->toBe('12v')
        ->and($page->images()->count())->toBe(1);
});

test('deleting a page takes its images and its breaks with it', function () {
    $page = ManuscriptPage::factory()->create();
    ManuscriptImage::factory()->for($page->manuscript)->for($page, 'manuscriptPage')->create();
    TranscriptionPageBreak::factory()->for($page, 'manuscriptPage')->create();

    $page->delete();

    expect(ManuscriptImage::count())->toBe(0)
        ->and(TranscriptionPageBreak::count())->toBe(0);
});

test('a page begins in one place in a transcription', function () {
    $transcription = Transcription::factory()->create();
    $page = ManuscriptPage::factory()->create();

    TranscriptionPageBreak::factory()->for($transcription)
        ->for($page, 'manuscriptPage')->create(['start_line' => 0]);

    expect(fn () => TranscriptionPageBreak::factory()->for($transcription)
        ->for($page, 'manuscriptPage')->create(['start_line' => 4]))
        ->toThrow(QueryException::class);
});

test('one division serves both layers, resolving to each layer\'s own offsets', function () {
    // A page holds a stretch of the manuscript and both layers transcribe that
    // same stretch, so where it begins is a fact about the transcription. The
    // coordinate is the line, the one thing the two share: their characters
    // differ, since the diplomatic layer carries markup the normalized one
    // does not.
    $diplomatic = TranscriptionLayer::factory()->diplomatic()
        ->create(['text' => "ΑΛΦΑ [ΒΗΤΑ]\nΓΑΜΜΑ"]);
    $normalized = TranscriptionLayer::factory()->normalized()
        ->for($diplomatic->transcription)->create(['text' => "ἄλφα βῆτα\nγάμμα"]);

    TranscriptionPageBreak::factory()->for($diplomatic->transcription)
        ->create(['start_line' => 1]);

    expect($diplomatic->transcription->pageBreaks()->count())->toBe(1)
        // Same line, different offsets — which is the whole point of holding
        // the division in lines.
        ->and($diplomatic->offsetOfLine(1))->toBe(12)
        ->and($normalized->offsetOfLine(1))->toBe(10);
});

test('editing within a line leaves the page divisions alone', function () {
    // The division is a line, so changing characters inside one does not move
    // it — which is the point of holding it that way.
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => "the quick fox\njumps high"]);

    $break = TranscriptionPageBreak::factory()->for($layer->transcription)
        ->create(['start_line' => 1]);

    $this->patch(route('transcriptions.text.update', $layer), [
        'ops' => [['start' => 4, 'end' => 9, 'text' => 'slow']],
        'text' => "the slow fox\njumps high",
    ])->assertRedirect();

    expect($break->fresh()->start_line)->toBe(1)
        // ...and it still resolves to the same words.
        ->and(mb_substr($layer->fresh()->text, $layer->fresh()->offsetOfLine(1), 5))->toBe('jumps');
});

test('adding a line before a page pushes the division down with it', function () {
    // Whole lines are what a line-numbered division has to notice, and the
    // offsets it is computed through are what notice them.
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => "one\ntwo\nthree"]);

    $break = TranscriptionPageBreak::factory()->for($layer->transcription)
        ->create(['start_line' => 2]);

    $this->patch(route('transcriptions.text.update', $layer), [
        'ops' => [['start' => 0, 'end' => 0, 'text' => "zero\n"]],
        'text' => "zero\none\ntwo\nthree",
    ])->assertRedirect();

    expect($break->fresh()->start_line)->toBe(3)
        ->and(mb_substr($layer->fresh()->text, $layer->fresh()->offsetOfLine(3), 5))->toBe('three');
});

test('a page break survives its whole page being deleted', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => "page one\npage two"]);

    $break = TranscriptionPageBreak::factory()->for($layer->transcription)
        ->create(['start_line' => 1]);

    $this->patch(route('transcriptions.text.update', $layer), [
        'ops' => [['start' => 9, 'end' => 17, 'text' => '']],
        'text' => "page one\n",
    ])->assertRedirect();

    // Emptied, not abolished: the page is still a page of the manuscript.
    expect($break->fresh())->not->toBeNull()
        ->and($break->fresh()->start_line)->toBe(1);
});
