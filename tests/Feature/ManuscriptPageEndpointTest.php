<?php

use App\Models\Manuscript;
use App\Models\ManuscriptPage;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionPageBreak;
use App\Models\User;

test('an editor can add a page to a manuscript that has no images', function () {
    $this->actingAs(User::factory()->editor()->create());
    $manuscript = Manuscript::factory()->create();

    $this->post(route('manuscript-pages.store', $manuscript), ['label' => 'f. 3v'])
        ->assertRedirect();

    expect($manuscript->pages()->sole()->label)->toBe('f. 3v');
});

test('pages are appended after the ones already there', function () {
    $this->actingAs(User::factory()->editor()->create());
    $manuscript = Manuscript::factory()->create();
    $manuscript->pages()->create(['label' => '1r', 'position' => 4]);

    $this->post(route('manuscript-pages.store', $manuscript), ['label' => '1v']);

    expect((float) $manuscript->pages()->where('label', '1v')->sole()->position)->toBe(5.0);
});

test('a page needs a label', function () {
    $this->actingAs(User::factory()->editor()->create());

    $this->post(route('manuscript-pages.store', Manuscript::factory()->create()), [])
        ->assertInvalid(['label']);
});

test('an editor can delete a page, taking its images and breaks but not the text', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => "page one\npage two"]);
    $page = ManuscriptPage::factory()->create();
    TranscriptionPageBreak::factory()->for($layer->transcription)
        ->for($page, 'manuscriptPage')->create(['start_line' => 1]);

    $this->delete(route('manuscript-pages.destroy', $page))->assertRedirect();

    expect(ManuscriptPage::count())->toBe(0)
        ->and(TranscriptionPageBreak::count())->toBe(0)
        ->and($layer->fresh()->text)->toBe("page one\npage two");
});

test('a guest cannot delete a page', function () {
    $this->actingAs(User::factory()->create());

    $this->delete(route('manuscript-pages.destroy', ManuscriptPage::factory()->create()))
        ->assertForbidden();
});

test('a guest cannot add a page', function () {
    $this->actingAs(User::factory()->create());

    $this->post(route('manuscript-pages.store', Manuscript::factory()->create()), ['label' => '1r'])
        ->assertForbidden();
});

test('an editor places a page in a layer by saying where it begins', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => "page one\npage two"]);
    $page = ManuscriptPage::factory()->create();

    // Given as an offset in the layer on screen, recorded as the line it falls
    // on — the coordinate both layers share.
    $this->post(route('transcription-page-breaks.store', $layer), [
        'manuscript_page_id' => $page->id,
        'start_offset' => 9,
    ])->assertRedirect();

    expect($layer->transcription->pageBreaks()->sole()->start_line)->toBe(1);
});

test('placing a page again moves it rather than adding a second break', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => "one\ntwo\nthree"]);
    $page = ManuscriptPage::factory()->create();

    foreach ([8, 4] as $offset) {
        $this->post(route('transcription-page-breaks.store', $layer), [
            'manuscript_page_id' => $page->id,
            'start_offset' => $offset,
        ])->assertRedirect();
    }

    expect($layer->transcription->pageBreaks()->count())->toBe(1)
        ->and($layer->transcription->pageBreaks()->sole()->start_line)->toBe(1);
});

test('a break can sit at the very end, for a page not yet transcribed', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => "page one\n"]);

    $this->post(route('transcription-page-breaks.store', $layer), [
        'manuscript_page_id' => ManuscriptPage::factory()->create()->id,
        'start_offset' => 9,
    ])->assertRedirect();

    expect($layer->transcription->pageBreaks()->sole()->start_line)->toBe(1);
});

test('a break cannot be placed past the end of the text', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => 'page one']);

    $this->post(route('transcription-page-breaks.store', $layer), [
        'manuscript_page_id' => ManuscriptPage::factory()->create()->id,
        'start_offset' => 99,
    ])->assertInvalid(['start_offset']);
});

test('unplacing a page leaves the text alone', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => "page one\npage two"]);
    $break = TranscriptionPageBreak::factory()->for($layer->transcription)
        ->create(['start_line' => 1]);

    $this->delete(route('transcription-page-breaks.destroy', $break))->assertRedirect();

    expect($layer->transcription->pageBreaks()->count())->toBe(0)
        ->and($layer->fresh()->text)->toBe("page one\npage two");
});
