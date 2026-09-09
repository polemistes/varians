<?php

use App\Http\Controllers\Admin\UsersController;
use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\Auth\LogoutController;
use App\Http\Controllers\Auth\RegisterController;
use App\Http\Controllers\BibliographyItemController;
use App\Http\Controllers\BibliographyReferenceController;
use App\Http\Controllers\ConjectureController;
use App\Http\Controllers\ConjectureOrderingController;
use App\Http\Controllers\EditionAdoptionController;
use App\Http\Controllers\EditionCommentController;
use App\Http\Controllers\EditionController;
use App\Http\Controllers\EditionLemmaController;
use App\Http\Controllers\EditionLineationController;
use App\Http\Controllers\EditionOrderController;
use App\Http\Controllers\EditionPassageController;
use App\Http\Controllers\EditionVariantController;
use App\Http\Controllers\HomeController;
use App\Http\Controllers\ManuscriptImageController;
use App\Http\Controllers\ManuscriptImageFeatureController;
use App\Http\Controllers\ManuscriptPageController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\TranscriptionController;
use App\Http\Controllers\TranscriptionPageBreakController;
use App\Http\Controllers\TranscriptionRegionController;
use App\Http\Controllers\TranscriptionSegmentController;
use App\Http\Controllers\TranscriptionSpanCopyController;
use App\Http\Controllers\TranscriptionSpanRestoreController;
use App\Http\Controllers\TranscriptionTextController;
use App\Http\Controllers\WitnessController;
use App\Http\Controllers\WorkController;
use Illuminate\Support\Facades\Route;

// Open reads — everyone, including anonymous visitors, subject to the
// published/draft visibility rules enforced inside each controller.
//
// The two "create" GET routes below are editor-only, but must stay registered
// here — before their sibling {work:slug}/{witness} show routes — since
// Laravel matches routes in registration order and "create" would otherwise
// be swallowed by the wildcard show route (tried as a slug/id and 404ing).
Route::get('/', [HomeController::class, 'index'])->name('home');
Route::get('/works/create', [WorkController::class, 'create'])->name('works.create')
    ->middleware('role:editor');
Route::get('/works/{work:slug}', [WorkController::class, 'show'])->name('works.show');
Route::get('/works/{work:slug}/editions/create', [EditionController::class, 'create'])->name('editions.create')
    ->middleware('role:editor');
Route::get('/works/{work:slug}/editions/{edition}', [EditionController::class, 'show'])->name('editions.show');
Route::get('/witnesses/create', [WitnessController::class, 'create'])->name('witnesses.create')
    ->middleware('role:editor');
Route::get('/witnesses/{witness}', [WitnessController::class, 'show'])->name('witnesses.show');
Route::get('/transcriptions/{transcription}', [TranscriptionController::class, 'show'])
    ->name('transcriptions.show');

// The common bibliography is reference data: readable by everyone, as a
// page and as a .bib file; only editors change it (below).
Route::get('/bibliography', [BibliographyItemController::class, 'index'])->name('bibliography.index');
Route::get('/bibliography/export', [BibliographyItemController::class, 'export'])->name('bibliography.export');
Route::get('/editions/{edition}/bibliography.bib', [BibliographyItemController::class, 'exportEdition'])->name('editions.bibliography.export');

// Guest-only auth entry points.
Route::middleware('guest')->group(function () {
    Route::get('/register', [RegisterController::class, 'create'])->name('register');
    Route::post('/register', [RegisterController::class, 'store']);
    Route::get('/login', [LoginController::class, 'create'])->name('login');
    Route::post('/login', [LoginController::class, 'store']);
});

// Any authenticated user — logout and their own profile only.
Route::middleware('auth')->group(function () {
    Route::post('/logout', [LogoutController::class, 'store'])->name('logout');
    Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
});

// Editor and administrator — creating and mutating content. Fully
// collaborative: any editor can act on anything, not just their own.
Route::middleware('role:editor')->group(function () {
    Route::post('/bibliography', [BibliographyItemController::class, 'store'])->name('bibliography.store');
    Route::post('/bibliography/import', [BibliographyItemController::class, 'import'])->name('bibliography.import');
    Route::patch('/bibliography/{item}', [BibliographyItemController::class, 'update'])->name('bibliography.update');
    Route::delete('/bibliography/{item}', [BibliographyItemController::class, 'destroy'])->name('bibliography.destroy');
    // The picker's typeahead, and citations of things that already exist
    // (a new conjecture carries its citations in its own request).
    Route::get('/bibliography/search', [BibliographyReferenceController::class, 'search'])->name('bibliography.search');
    Route::post('/bibliography-references', [BibliographyReferenceController::class, 'store'])->name('bibliography-references.store');
    Route::patch('/bibliography-references/{reference}', [BibliographyReferenceController::class, 'update'])->name('bibliography-references.update');
    Route::delete('/bibliography-references/{reference}', [BibliographyReferenceController::class, 'destroy'])->name('bibliography-references.destroy');

    Route::post('/works', [WorkController::class, 'store'])->name('works.store');
    Route::patch('/works/{work:slug}', [WorkController::class, 'update'])->name('works.update');
    Route::delete('/works/{work:slug}', [WorkController::class, 'destroy'])->name('works.destroy');

    Route::post('/works/{work:slug}/editions', [EditionController::class, 'store'])->name('editions.store');
    Route::patch('/editions/{edition}', [EditionController::class, 'update'])->name('editions.update');
    Route::delete('/editions/{edition}', [EditionController::class, 'destroy'])->name('editions.destroy');

    // An edition's own scope, order, and per-passage source transcription —
    // see EditionPassage. The single add resolves already-cited segments
    // inside a raw drag-selected span; the bulk add ("base a range")
    // resolves them by citation range but orders by the transcription's own
    // physical offset, not citation order — the whole point of the redesign.
    Route::post('/editions/{edition}/passages', [EditionPassageController::class, 'store'])
        ->name('edition-passages.store');
    Route::post('/editions/{edition}/passages/bulk', [EditionPassageController::class, 'storeBulk'])
        ->name('edition-passages.store-bulk');
    Route::delete('/editions/{edition}/passages', [EditionPassageController::class, 'destroy'])
        ->name('edition-passages.destroy');

    // The single "seamlessly add this to the edition" action — materializes
    // a passage's shared Lemma columns on first touch if needed, then
    // places and selects whichever candidate was picked. See
    // EditionVariantController.
    Route::post('/editions/{edition}/variants', [EditionVariantController::class, 'store'])
        ->name('edition-variants.store');

    // This edition's own lineation — passage-boundary flags and
    // within-passage (colometry) breaks. Pure display choices; see
    // EditionLineationController.
    Route::patch('/editions/{edition}/line-breaks', [EditionLineationController::class, 'updateBreak'])
        ->name('edition-line-breaks.update');
    Route::patch('/edition-passages/{editionPassage}/lineation', [EditionLineationController::class, 'updatePassage'])
        ->name('edition-passages.lineation.update');

    // Applying an order-report candidate (a witness's sequence, a
    // catalogued conjecture, or citation order) to a flagged range. See
    // EditionOrderController. The editor's own rearrangement is a
    // conjecture, registered through conjecture-orderings.store.
    Route::post('/editions/{edition}/order/apply', [EditionOrderController::class, 'applyCandidate'])
        ->name('edition-order.apply');

    // Authors a brand-new ConjectureType::Reordering from a freely-arranged
    // sequence — the edition page's "Register transposition conjecture"
    // (cut & paste in the text) and the order panel's proposal form — and
    // follows it for this edition in the same step unless told not to.
    Route::post('/editions/{edition}/conjecture-orderings', [ConjectureOrderingController::class, 'store'])
        ->name('conjecture-orderings.store');

    // Adopts a catalogued Reordering/Transposition for this edition from
    // wherever it is reported — including one that divides a line, which
    // the edition then prints in pieces (ArrangementAdopter).
    Route::post('/editions/{edition}/adoptions', [EditionAdoptionController::class, 'store'])
        ->name('edition-adoptions.store');

    // Which reading an edition prints for a lemma is chosen through
    // edition-variants.store; this only withdraws such a choice.
    Route::delete('/editions/{edition}/lemmas/{lemma}/selection', [EditionLemmaController::class, 'destroy'])
        ->name('edition-lemmas.destroy');

    // An editor's own free-text notes on her edition — the judgments the
    // apparatus's vocabulary can't carry (accentuation, word division,
    // speaker assignment, why this reading was printed). See EditionComment.
    Route::post('/editions/{edition}/comments', [EditionCommentController::class, 'store'])
        ->name('edition-comments.store');
    Route::patch('/edition-comments/{comment}', [EditionCommentController::class, 'update'])
        ->name('edition-comments.update');
    Route::delete('/edition-comments/{comment}', [EditionCommentController::class, 'destroy'])
        ->name('edition-comments.destroy');

    Route::post('/canonical-passages/{canonicalPassage}/conjectures', [ConjectureController::class, 'store'])
        ->name('conjectures.store');
    Route::patch('/conjectures/{conjecture}', [ConjectureController::class, 'update'])
        ->name('conjectures.update');
    Route::delete('/conjectures/{conjecture}', [ConjectureController::class, 'destroy'])
        ->name('conjectures.destroy');

    Route::post('/witnesses', [WitnessController::class, 'store'])->name('witnesses.store');
    Route::patch('/witnesses/{witness}', [WitnessController::class, 'update'])->name('witnesses.update');
    Route::delete('/witnesses/{witness}', [WitnessController::class, 'destroy'])->name('witnesses.destroy');
    Route::post('/witnesses/{witness}/transcriptions', [TranscriptionController::class, 'store'])
        ->name('witnesses.transcriptions.store');

    Route::patch('/transcriptions/{transcription}', [TranscriptionController::class, 'update'])
        ->name('transcriptions.update');
    Route::delete('/transcriptions/{transcription}', [TranscriptionController::class, 'destroy'])
        ->name('transcriptions.destroy');

    // Applies an ordered log of exact edit operations from the in-place text
    // editor, transforming every segment/region offset deterministically in
    // the same pass — see SpanTransformer. Distinct from transcriptions.update
    // (tags/visibility), which no longer touches text at all.
    Route::patch('/transcriptions/{transcription}/text', [TranscriptionTextController::class, 'update'])
        ->name('transcriptions.text.update');

    Route::post('/transcriptions/{transcription}/segments', [TranscriptionSegmentController::class, 'store'])
        ->name('transcription-segments.store');
    // Undoing a destructive text edit restores the citations AND image
    // mappings it destroyed along with the text — the client's edit
    // history snapshots the rows.
    Route::post('/transcriptions/{transcription}/span-restores', [TranscriptionSpanRestoreController::class, 'store'])
        ->name('transcription-spans.restore');
    Route::patch('/transcription-segments/{segment}', [TranscriptionSegmentController::class, 'update'])
        ->name('transcription-segments.update');
    Route::patch('/transcription-segments/{segment}/assignment', [TranscriptionSegmentController::class, 'assignCitation'])
        ->name('transcription-segments.assign');
    Route::delete('/transcription-segments/{segment}', [TranscriptionSegmentController::class, 'destroy'])
        ->name('transcription-segments.destroy');

    Route::post('/transcriptions/{transcription}/span-copies', [TranscriptionSpanCopyController::class, 'store'])
        ->name('transcriptions.span-copies.store');
    Route::post('/witnesses/{witness}/pages', [ManuscriptPageController::class, 'store'])
        ->name('manuscript-pages.store');
    Route::patch('/manuscript-pages/{page}', [ManuscriptPageController::class, 'update'])
        ->name('manuscript-pages.update');
    Route::delete('/manuscript-pages/{page}', [ManuscriptPageController::class, 'destroy'])
        ->name('manuscript-pages.destroy');

    Route::post('/transcriptions/{transcription}/page-breaks', [TranscriptionPageBreakController::class, 'store'])
        ->name('transcription-page-breaks.store');
    Route::delete('/transcription-page-breaks/{pageBreak}', [TranscriptionPageBreakController::class, 'destroy'])
        ->name('transcription-page-breaks.destroy');

    Route::post('/witnesses/{witness}/images', [ManuscriptImageController::class, 'store'])
        ->name('manuscript-images.store');
    Route::delete('/manuscript-images/{image}', [ManuscriptImageController::class, 'destroy'])
        ->name('manuscript-images.destroy');

    Route::post('/manuscript-images/{image}/features', [ManuscriptImageFeatureController::class, 'store'])
        ->name('manuscript-image-features.store');
    Route::delete('/manuscript-image-features/{feature}', [ManuscriptImageFeatureController::class, 'destroy'])
        ->name('manuscript-image-features.destroy');

    Route::post('/transcriptions/{transcription}/regions', [TranscriptionRegionController::class, 'store'])
        ->name('transcription-regions.store');
    Route::post('/transcriptions/{transcription}/regions/batch', [TranscriptionRegionController::class, 'storeBatch'])
        ->name('transcription-regions.store-batch');
    Route::patch('/transcription-regions/{region}', [TranscriptionRegionController::class, 'update'])
        ->name('transcription-regions.update');
    Route::delete('/transcription-regions/{region}', [TranscriptionRegionController::class, 'destroy'])
        ->name('transcription-regions.destroy');
    Route::delete('/transcriptions/{transcription}/regions', [TranscriptionRegionController::class, 'destroySpan'])
        ->name('transcription-regions.destroy-span');
});

// Administrator only — the one capability editors don't have: managing roles.
Route::middleware('role:administrator')->prefix('admin')->name('admin.')->group(function () {
    Route::get('/users', [UsersController::class, 'index'])->name('users.index');
    Route::patch('/users/{user}/role', [UsersController::class, 'updateRole'])->name('users.role.update');
});
