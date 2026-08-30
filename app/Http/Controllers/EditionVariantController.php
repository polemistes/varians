<?php

namespace App\Http\Controllers;

use App\Enums\ConjectureType;
use App\Http\Requests\StoreEditionVariantRequest;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\EditionPassage;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\Transcription;
use App\Support\Edition\CanonicalPassageResolver;
use App\Support\Edition\ReadingSourceResolver;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use LogicException;

class EditionVariantController extends Controller
{
    /**
     * The single "seamlessly add this to the edition" action for word-level
     * decisions on a passage already in the edition (see EditionPassage —
     * scope/materialization happens at add time now, via PassageAdder, not
     * here): places whichever candidate was picked — either an *existing*
     * candidate on one clicked column (`placement: existing` — a witness
     * reading, an existing conjecture, or a new supplement; the reading
     * picked may itself span several columns, see below), a brand new
     * zero-width column that competes with nothing (`placement: insert` — a
     * lacuna, new or previously catalogued), or a candidate spanning one or
     * more *existing* columns that doesn't exist as a reading yet
     * (`placement: range` — a brand new substitution conjecture, a single
     * word being just a range of one, or a witness's own wider reading an
     * editor is comparing/adopting for the first time even though
     * PassageAligner never had a divergence to merge it from automatically)
     * — and, except when authoring a brand new substitution (see
     * isNewSubstitution — that only catalogues it, adopting is a separate
     * later pick), selects it for this edition. `placement: new_passage`
     * (a whole-line lacuna with no manuscript witness) is different enough —
     * it creates the EditionPassage itself, rather than requiring one to
     * already exist — that it's handled entirely separately, see
     * storeWholeLineLacuna().
     */
    public function store(StoreEditionVariantRequest $request, Edition $edition): RedirectResponse
    {
        $placement = $request->validated('placement') ?? 'existing';

        if ($placement === 'new_passage') {
            return $this->storeWholeLineLacuna($request, $edition);
        }

        $passage = CanonicalPassage::findOrFail((int) $request->validated('canonical_passage_id'));
        $editionPassage = EditionPassage::where('edition_id', $edition->id)
            ->where('canonical_passage_id', $passage->id)
            ->first();

        if ($editionPassage === null) {
            throw ValidationException::withMessages([
                'canonical_passage_id' => 'This passage hasn\'t been added to the edition yet.',
            ]);
        }

        $base = $editionPassage->transcription;

        DB::transaction(function () use ($request, $edition, $passage, $base, $placement) {
            [$lemma, $rangeEndLemma] = match ($placement) {
                'insert' => [$this->resolveInsertedLemma($request, $passage, $base), null],
                'range' => $this->resolveRange($request, $passage, $base),
                default => [$this->resolveLemma($request, $passage, $base), null],
            };

            $attributes = ReadingSourceResolver::resolve($request->validated(), $passage->id, $request->user()->id);
            $attributes['range_end_lemma_id'] = $rangeEndLemma?->id;

            $this->guardSupplementMatchesLemma($request, $lemma, $attributes);

            // A witness-sourced reading picked via ordinary placement=existing
            // is never originated here — it's always PassageAligner's own
            // doing at materialization time (possibly spanning several
            // columns, see PassageAligner), so that's always a lookup, never
            // a firstOrCreate. placement=range is different: a witness can
            // agree word-for-word with its neighbours across a whole
            // conjecture's disputed span without PassageAligner ever having a
            // divergence to detect there, so nothing merged those columns for
            // it automatically — picking that wider comparison (see
            // EditionController::witnessExtension, which is what offers it)
            // creates the matching range-shaped reading on the spot instead.
            // A catalogued conjecture is looked up by its own conjecture_id
            // alone, never combined with $attributes['range_end_lemma_id'] in
            // the search — that's derived from $placement (always null for
            // the ordinary placement=existing pick this arrives through),
            // which would silently miss a conjecture that was itself
            // authored as a range and mint a wrong, narrow duplicate reading
            // instead of finding the real one. Still firstOrCreate, not
            // firstOrFail: a conjecture catalogued with no placement at all
            // (see ConjectureController) is being placed here for the first
            // time, at exactly the single column $placement=existing implies.
            $reading = match (true) {
                $request->validated('source') === 'new_conjecture' => $lemma->readings()->create($attributes),
                $request->validated('source') === 'transcription' && $placement === 'range' => LemmaReading::firstOrCreate([
                    'lemma_id' => $lemma->id,
                    'transcription_id' => $attributes['transcription_id'],
                    'start_offset' => $attributes['start_offset'],
                    'end_offset' => $attributes['end_offset'],
                ], ['range_end_lemma_id' => $attributes['range_end_lemma_id']]),
                $request->validated('source') === 'transcription' => LemmaReading::where('lemma_id', $lemma->id)
                    ->where('transcription_id', $attributes['transcription_id'])
                    ->where('start_offset', $attributes['start_offset'])
                    ->where('end_offset', $attributes['end_offset'])
                    ->firstOrFail(),
                $request->validated('source') === 'existing_conjecture' => LemmaReading::firstOrCreate([
                    'lemma_id' => $lemma->id,
                    'conjecture_id' => $attributes['conjecture_id'],
                ], ['range_end_lemma_id' => $attributes['range_end_lemma_id']]),
                default => throw new LogicException('Unreachable: source is validated against a fixed list of values.'),
            };

            // Authoring a brand new substitution only catalogues it as a
            // candidate — it doesn't adopt it. Adopting is a separate,
            // explicit act (picking it from the column's candidate list,
            // same as picking anything else already sitting there), so
            // nothing here should touch this edition's existing decisions.
            if ($this->isNewSubstitution($request)) {
                return;
            }

            // Derived from the resolved reading's own range, not from
            // $placement — a witness-sourced range reading picked via
            // ordinary placement=existing still needs to clear whatever
            // else currently claims the ground it covers.
            $this->clearOverlappingSelections(
                $edition,
                $passage,
                $lemma,
                $reading->range_end_lemma_id !== null ? Lemma::findOrFail($reading->range_end_lemma_id) : $lemma,
            );

            EditionLemma::updateOrCreate(
                ['edition_id' => $edition->id, 'lemma_id' => $lemma->id],
                ['selected_reading_id' => $reading->id],
            );
        });

        return back();
    }

    /**
     * A whole-line lacuna has no manuscript witness at all, so unlike every
     * other placement it creates its own EditionPassage (transcription_id
     * null) rather than requiring one to already exist —
     * `insert_after_edition_passage_id` anchors where it lands in this
     * edition's own order. Idempotent per label: a repeat submission finds
     * the same CanonicalPassage/Lemma/EditionPassage and only adds a new
     * competing reading, which — like any lacuna — auto-selects.
     */
    private function storeWholeLineLacuna(StoreEditionVariantRequest $request, Edition $edition): RedirectResponse
    {
        $passage = CanonicalPassageResolver::resolve($edition->work, $request->validated('label'));

        DB::transaction(function () use ($request, $edition, $passage) {
            $lemma = $this->resolveWholePassageLemma($passage);

            $editionPassage = EditionPassage::where('edition_id', $edition->id)
                ->where('canonical_passage_id', $passage->id)
                ->first();

            if ($editionPassage === null) {
                EditionPassage::create([
                    'edition_id' => $edition->id,
                    'canonical_passage_id' => $passage->id,
                    'transcription_id' => null,
                    'position' => $this->positionAfter($edition, $request->validated('insert_after_edition_passage_id')),
                ]);
            }

            $attributes = ReadingSourceResolver::resolve($request->validated(), $passage->id, $request->user()->id);
            $attributes['range_end_lemma_id'] = null;

            $reading = $lemma->readings()->create($attributes);

            EditionLemma::updateOrCreate(
                ['edition_id' => $edition->id, 'lemma_id' => $lemma->id],
                ['selected_reading_id' => $reading->id],
            );
        });

        return back();
    }

    /**
     * The midpoint between an anchor EditionPassage's own position (or 0.0,
     * for "at the very start") and whatever currently follows it — same
     * insertable-ordinal technique resolveInsertedLemma() already uses for
     * a point lacuna's Lemma.position.
     */
    private function positionAfter(Edition $edition, ?int $afterEditionPassageId): float
    {
        $after = $afterEditionPassageId !== null ? EditionPassage::findOrFail($afterEditionPassageId) : null;
        $afterPosition = $after !== null ? (float) $after->position : 0.0;

        $next = EditionPassage::where('edition_id', $edition->id)
            ->where('position', '>', $afterPosition)
            ->orderBy('position')
            ->first();
        $beforePosition = $next !== null ? (float) $next->position : $afterPosition + 1;

        return $afterPosition + ($beforePosition - $afterPosition) / 2;
    }

    private function resolveLemma(StoreEditionVariantRequest $request, CanonicalPassage $passage, ?Transcription $base): Lemma
    {
        $lemmaId = $request->validated('lemma_id');

        if ($lemmaId !== null) {
            return Lemma::findOrFail((int) $lemmaId);
        }

        $reading = $base !== null
            ? LemmaReading::where('transcription_id', $base->id)
                ->where('start_offset', (int) $request->validated('base_start_offset'))
                ->where('end_offset', (int) $request->validated('base_end_offset'))
                ->whereHas('lemma', fn ($query) => $query->where('canonical_passage_id', $passage->id))
                ->first()
            : null;

        if ($reading !== null) {
            return $reading->lemma;
        }

        // A zero-width base span (a pure insertion the base itself doesn't
        // attest) has no base-anchored reading to match — locate it by the
        // specific candidate being picked instead.
        if ($request->validated('source') === 'transcription') {
            $reading = LemmaReading::where('transcription_id', (int) $request->validated('transcription_id'))
                ->where('start_offset', (int) $request->validated('start_offset'))
                ->where('end_offset', (int) $request->validated('end_offset'))
                ->whereHas('lemma', fn ($query) => $query->where('canonical_passage_id', $passage->id))
                ->first();

            if ($reading !== null) {
                return $reading->lemma;
            }
        }

        throw ValidationException::withMessages([
            'base_start_offset' => 'This passage\'s structure has changed — please refresh and try again.',
        ]);
    }

    /**
     * Create a brand new column positioned between two existing ones (or at
     * either end) — never a competing candidate for an existing word, which
     * is exactly what a lacuna needs: it doesn't replace anything.
     */
    private function resolveInsertedLemma(StoreEditionVariantRequest $request, CanonicalPassage $passage, ?Transcription $base): Lemma
    {
        $afterLemmaId = $request->validated('insert_after_lemma_id');
        $afterLemma = $afterLemmaId !== null
            ? Lemma::findOrFail((int) $afterLemmaId)
            : $this->findLemmaEndingAt($passage, $base, $request->validated('insert_after_base_offset'), 'insert_after_base_offset');

        $siblings = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->get();
        $afterPosition = $afterLemma !== null ? (float) $afterLemma->position : 0.0;
        $nextLemma = $siblings->first(fn (Lemma $lemma) => (float) $lemma->position > $afterPosition);
        $beforePosition = $nextLemma !== null ? (float) $nextLemma->position : $afterPosition + 1;

        return Lemma::create([
            'canonical_passage_id' => $passage->id,
            'position' => $afterPosition + ($beforePosition - $afterPosition) / 2,
        ]);
    }

    /**
     * The sole column of a brand-new (or previously touched) whole-line
     * lacuna passage — one that has no manuscript witness at all, so there's
     * nothing for materialize() to have seeded. firstOrCreate makes a
     * repeat `new_passage` submission for the same label land on the same
     * column instead of minting a second one, so a second lacuna proposal
     * for "80A" becomes a competing reading on this one lemma, exactly like
     * any other conjecture.
     */
    private function resolveWholePassageLemma(CanonicalPassage $passage): Lemma
    {
        return Lemma::firstOrCreate(
            ['canonical_passage_id' => $passage->id],
            ['position' => 1.0],
        );
    }

    /**
     * Resolve the two ends of a range placement — a brand new substitution
     * conjecture, or a witness's own wider reading being compared/adopted
     * for the first time (see EditionController::witnessExtension) — the
     * same dual by-id-once-materialized / by-exact-base-offset-otherwise
     * lookup `resolveLemma()` already does for one column, done for both
     * edges. The ends may name the same lemma (the single-word case), in
     * which case the second element is null — `range_end_lemma_id` only
     * ever carries a value when more than one column is genuinely spanned,
     * exactly the convention PassageAligner's own automatic detection
     * already uses. Never merges/creates anything on the Lemma side; a
     * genuine range is carried entirely on the new reading's own
     * `range_end_lemma_id`.
     *
     * @return array{0: Lemma, 1: ?Lemma}
     */
    private function resolveRange(StoreEditionVariantRequest $request, CanonicalPassage $passage, ?Transcription $base): array
    {
        $startLemmaId = $request->validated('range_start_lemma_id');
        $startLemma = $startLemmaId !== null
            ? Lemma::findOrFail((int) $startLemmaId)
            : $this->findLemmaStartingAt($passage, $base, (int) $request->validated('range_start_base_offset'), 'range_start_base_offset');

        $endLemmaId = $request->validated('range_end_lemma_id');
        $endLemma = $endLemmaId !== null
            ? Lemma::findOrFail((int) $endLemmaId)
            : $this->findLemmaEndingAt($passage, $base, (int) $request->validated('range_end_base_offset'), 'range_end_base_offset');

        if ($startLemma === null || $endLemma === null || (float) $endLemma->position < (float) $startLemma->position) {
            throw ValidationException::withMessages([
                'range_end_lemma_id' => 'The range\'s end must not come before its start.',
            ]);
        }

        return [$startLemma, $endLemma->id === $startLemma->id ? null : $endLemma];
    }

    private function findLemmaEndingAt(CanonicalPassage $passage, ?Transcription $base, ?int $baseOffset, string $errorField): ?Lemma
    {
        if ($baseOffset === null || $base === null) {
            return null;
        }

        $reading = LemmaReading::where('transcription_id', $base->id)
            ->where('end_offset', $baseOffset)
            ->whereHas('lemma', fn ($query) => $query->where('canonical_passage_id', $passage->id))
            ->first();

        if ($reading === null) {
            throw ValidationException::withMessages([
                $errorField => 'This passage\'s structure has changed — please refresh and try again.',
            ]);
        }

        return $reading->lemma;
    }

    private function findLemmaStartingAt(CanonicalPassage $passage, ?Transcription $base, ?int $baseOffset, string $errorField): ?Lemma
    {
        if ($baseOffset === null || $base === null) {
            return null;
        }

        $reading = LemmaReading::where('transcription_id', $base->id)
            ->where('start_offset', $baseOffset)
            ->whereHas('lemma', fn ($query) => $query->where('canonical_passage_id', $passage->id))
            ->first();

        if ($reading === null) {
            throw ValidationException::withMessages([
                $errorField => 'This passage\'s structure has changed — please refresh and try again.',
            ]);
        }

        return $reading->lemma;
    }

    /**
     * An adopted decision (plain or range) claims every lemma position from
     * its own start through its (possibly same) end. Clearing whatever
     * previously claimed any of that ground — for this edition only —
     * keeps exactly one EditionLemma row owning each position at a time.
     * The row about to be written is excluded: re-deciding a lemma that
     * already has a decision is an overwrite via updateOrCreate afterward,
     * never a delete-then-recreate. No confirmation needed — an EditionLemma
     * row is a cheap, re-derivable pointer, not scholarly data; nothing it
     * points at is ever touched.
     */
    private function clearOverlappingSelections(Edition $edition, CanonicalPassage $passage, Lemma $rangeStart, Lemma $rangeEnd): void
    {
        $startPosition = (float) $rangeStart->position;
        $endPosition = (float) $rangeEnd->position;

        EditionLemma::where('edition_id', $edition->id)
            ->where('lemma_id', '!=', $rangeStart->id)
            ->whereHas('lemma', fn ($query) => $query->where('canonical_passage_id', $passage->id))
            ->with(['lemma:id,position', 'selectedReading:id,range_end_lemma_id', 'selectedReading.rangeEndLemma:id,position'])
            ->get()
            ->each(function (EditionLemma $selection) use ($startPosition, $endPosition): void {
                $ownStart = (float) $selection->lemma->position;
                $ownEnd = $selection->selectedReading->rangeEndLemma?->position !== null
                    ? (float) $selection->selectedReading->rangeEndLemma->position
                    : $ownStart;

                if ($ownEnd >= $startPosition && $ownStart <= $endPosition) {
                    $selection->delete();
                }
            });
    }

    /**
     * A supplement picked (existing or new) must fill a lacuna that's
     * actually a candidate on *this* lemma — otherwise it would end up
     * competing for a column its lacuna was never placed at.
     *
     * @param  array<string, mixed>  $attributes
     */
    private function guardSupplementMatchesLemma(StoreEditionVariantRequest $request, Lemma $lemma, array $attributes): void
    {
        if (! array_key_exists('conjecture_id', $attributes)) {
            return;
        }

        $conjecture = $request->validated('source') === 'new_conjecture'
            ? Conjecture::find((int) $attributes['conjecture_id'])
            : Conjecture::find((int) $request->validated('conjecture_id'));

        if ($conjecture?->type !== ConjectureType::Supplement) {
            return;
        }

        $lacunaOnThisLemma = $lemma->readings()->where('conjecture_id', $conjecture->supplements_conjecture_id)->exists();

        if (! $lacunaOnThisLemma) {
            throw ValidationException::withMessages([
                'conjecture_id' => 'That supplement belongs to a different lacuna.',
            ]);
        }
    }

    /**
     * A lacuna or supplement still adopts itself on creation — a lacuna has
     * nothing else to compete with at its own brand new column, and a
     * supplement explicitly names the one lacuna it fills. A substitution is
     * different: it's proposed into a column that may already hold a
     * perfectly good reading, so authoring one is never itself a decision.
     */
    private function isNewSubstitution(StoreEditionVariantRequest $request): bool
    {
        if ($request->validated('source') !== 'new_conjecture') {
            return false;
        }

        $type = $request->validated('conjecture_type') ?? ConjectureType::Substitution->value;

        return $type === ConjectureType::Substitution->value;
    }
}
