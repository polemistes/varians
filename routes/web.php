<?php

use App\Http\Controllers\Admin\UsersController;
use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\Auth\LogoutController;
use App\Http\Controllers\Auth\RegisterController;
use App\Http\Controllers\ConjectureController;
use App\Http\Controllers\ConjectureOrderingController;
use App\Http\Controllers\EditionCommentController;
use App\Http\Controllers\EditionController;
use App\Http\Controllers\EditionLemmaController;
use App\Http\Controllers\EditionPassageController;
use App\Http\Controllers\EditionPassageOrderController;
use App\Http\Controllers\EditionTranspositionController;
use App\Http\Controllers\EditionVariantController;
use App\Http\Controllers\HomeController;
use App\Http\Controllers\LemmaController;
use App\Http\Controllers\LemmaReadingController;
use App\Http\Controllers\ManuscriptImageController;
use App\Http\Controllers\ManuscriptImageFeatureController;
use App\Http\Controllers\ManuscriptPageController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\TextImportController;
use App\Http\Controllers\TranscriptionController;
use App\Http\Controllers\TranscriptionLayerCopyController;
use App\Http\Controllers\TranscriptionPageBreakController;
use App\Http\Controllers\TranscriptionRegionController;
use App\Http\Controllers\TranscriptionSegmentController;
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
    Route::post('/works', [WorkController::class, 'store'])->name('works.store');
    Route::patch('/works/{work:slug}', [WorkController::class, 'update'])->name('works.update');
    Route::delete('/works/{work:slug}', [WorkController::class, 'destroy'])->name('works.destroy');

    Route::post('/works/{work:slug}/text-imports', [TextImportController::class, 'store'])
        ->name('text-imports.store');

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
    Route::delete('/edition-passages/{editionPassage}', [EditionPassageController::class, 'destroy'])
        ->name('edition-passages.destroy');

    // The single "seamlessly add this to the edition" action — materializes
    // a passage's shared Lemma columns on first touch if needed, then
    // places and selects whichever candidate was picked. See
    // EditionVariantController.
    Route::post('/editions/{edition}/variants', [EditionVariantController::class, 'store'])
        ->name('edition-variants.store');

    // An edition-ordering proposal, not a word-level one — see
    // EditionTransposition. Recording one here both creates the underlying
    // Conjecture(type: transposition) and adopts it for this edition.
    Route::post('/editions/{edition}/transpositions', [EditionTranspositionController::class, 'store'])
        ->name('edition-transpositions.store');
    Route::delete('/edition-transpositions/{transposition}', [EditionTranspositionController::class, 'destroy'])
        ->name('edition-transpositions.destroy');

    // Which source's own internal sequence this edition follows for a range
    // of passages — sourced from either a transcription (never touches
    // Conjecture: the manuscript itself is the source, not a scholar's
    // proposal) or a catalogued Reordering conjecture. See EditionPassageOrder.
    Route::post('/editions/{edition}/passage-order', [EditionPassageOrderController::class, 'store'])
        ->name('edition-passage-orders.store');
    Route::delete('/edition-passage-orders/{editionPassageOrder}', [EditionPassageOrderController::class, 'destroy'])
        ->name('edition-passage-orders.destroy');

    // Authors a brand-new ConjectureType::Reordering from a freely-arranged
    // sequence and immediately selects it for this edition in one step —
    // mirrors edition-transpositions.store's "record and adopt together".
    Route::post('/editions/{edition}/conjecture-orderings', [ConjectureOrderingController::class, 'store'])
        ->name('conjecture-orderings.store');

    // A lemma is shared collation (which candidate readings exist for a
    // word/phrase slot), not owned by any one edition — see Lemma. Lemmas
    // and their readings are grown by alignment (see PassageAligner) and
    // materialized via edition-variants.store, not hand-built — these
    // remaining routes are for correcting an existing structure.
    Route::patch('/lemmas/{lemma}', [LemmaController::class, 'update'])
        ->name('lemmas.update');
    Route::delete('/lemmas/{lemma}', [LemmaController::class, 'destroy'])
        ->name('lemmas.destroy');

    Route::delete('/lemma-readings/{reading}', [LemmaReadingController::class, 'destroy'])
        ->name('lemma-readings.destroy');

    // Which of a lemma's candidate readings a given edition prints.
    Route::patch('/editions/{edition}/lemmas/{lemma}/selection', [EditionLemmaController::class, 'select'])
        ->name('edition-lemmas.select');
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
    Route::patch('/transcription-segments/{segment}', [TranscriptionSegmentController::class, 'update'])
        ->name('transcription-segments.update');
    Route::patch('/transcription-segments/{segment}/assignment', [TranscriptionSegmentController::class, 'assignCitation'])
        ->name('transcription-segments.assign');
    Route::delete('/transcription-segments/{segment}', [TranscriptionSegmentController::class, 'destroy'])
        ->name('transcription-segments.destroy');

    Route::get('/transcriptions/{transcription}/copy', [TranscriptionLayerCopyController::class, 'create'])
        ->name('transcriptions.copy.create');
    Route::post('/transcriptions/{transcription}/copy', [TranscriptionLayerCopyController::class, 'store'])
        ->name('transcriptions.copy.store');

    Route::post('/manuscripts/{manuscript}/pages', [ManuscriptPageController::class, 'store'])
        ->name('manuscript-pages.store');
    Route::delete('/manuscript-pages/{page}', [ManuscriptPageController::class, 'destroy'])
        ->name('manuscript-pages.destroy');

    Route::post('/transcriptions/{transcription}/page-breaks', [TranscriptionPageBreakController::class, 'store'])
        ->name('transcription-page-breaks.store');
    Route::delete('/transcription-page-breaks/{pageBreak}', [TranscriptionPageBreakController::class, 'destroy'])
        ->name('transcription-page-breaks.destroy');

    Route::post('/manuscripts/{manuscript}/images', [ManuscriptImageController::class, 'store'])
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
});

// Administrator only — the one capability editors don't have: managing roles.
Route::middleware('role:administrator')->prefix('admin')->name('admin.')->group(function () {
    Route::get('/users', [UsersController::class, 'index'])->name('users.index');
    Route::patch('/users/{user}/role', [UsersController::class, 'updateRole'])->name('users.role.update');
});
