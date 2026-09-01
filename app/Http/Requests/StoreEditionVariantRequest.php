<?php

namespace App\Http\Requests;

use App\Enums\ConjectureType;
use App\Enums\Layer;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\TranscriptionSegment;
use App\Support\Edition\ConjectureValidationRules;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreEditionVariantRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * `placement` picks which column the reading lands on:
     * - `existing` (the default): pick a reading that already exists as a
     *   candidate on one clicked column — `lemma_id` once the passage is
     *   touched, otherwise `base_start_offset`/`base_end_offset`, the exact
     *   span the live preview reported. A witness reading, an existing
     *   catalogued conjecture (substitution or supplement), or a brand new
     *   supplement (which targets its lacuna's own single column) belong
     *   here — never a brand new substitution, see `range` below.
     * - `insert`: a brand new zero-width column between two existing ones
     *   (or at either end) that doesn't compete with any word — the only
     *   way a lacuna gets created, since it never replaces text. Located by
     *   `insert_after_lemma_id` once touched, otherwise
     *   `insert_after_base_offset` (null for "at the very start" in either
     *   case). Only a lacuna — new or previously catalogued — belongs here.
     * - `range`: a candidate spanning one or more *existing* columns that
     *   doesn't exist as a reading yet, from `range_start_lemma_id`/
     *   `range_start_base_offset` through `range_end_lemma_id`/
     *   `range_end_base_offset` (same dual by-id/by-offset shape as
     *   `existing`, doubled for both ends — the two ends may name the same
     *   column, which is exactly the single-word case; there's no separate
     *   mechanism for it). Almost always a brand new substitution
     *   conjecture; the one exception is a witness's own wider reading an
     *   editor compares/adopts for the first time even though PassageAligner
     *   never had a divergence to merge it from automatically (see
     *   EditionController::witnessExtension) — everywhere else, a witness
     *   reading is placed via ordinary `existing` instead, since
     *   PassageAligner is normally the only thing that creates a witness's
     *   own multi-word reading. Never a lacuna/supplement (those have their
     *   own placements above).
     * - `new_passage`: a whole-line lacuna with no manuscript witness at
     *   all — `canonical_passage_id` is never sent for this placement;
     *   `label` names (and, on first mention, creates) the passage instead,
     *   via the work's own ReferenceScheme. `insert_after_edition_passage_id`
     *   anchors where it lands in this edition's own order (null = the very
     *   start) — only meaningful the first time this passage is added; a
     *   repeat submission for the same label finds the same EditionPassage
     *   and leaves its position alone. Only a brand new lacuna conjecture
     *   belongs here.
     *
     * The `conjecture_*` fields' *shape* is always validated (see
     * ConjectureValidationRules); whether they're required depends on
     * `placement`, `source`, and `conjecture_type` together, which
     * `withValidator` checks imperatively since declarative required_if/
     * required_unless can't express a three-way interaction.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return [
            'canonical_passage_id' => ['required_unless:placement,new_passage', Rule::exists('canonical_passages', 'id')->where('work_id', $edition->work_id)],
            'placement' => ['nullable', Rule::in(['existing', 'insert', 'range', 'new_passage'])],
            'label' => ['required_if:placement,new_passage', 'string', 'max:100'],
            'insert_after_edition_passage_id' => ['nullable', Rule::exists('edition_passages', 'id')->where('edition_id', $edition->id)],

            'lemma_id' => ['nullable', Rule::exists('lemmas', 'id')->where('canonical_passage_id', $this->input('canonical_passage_id'))],
            'base_start_offset' => ['nullable', 'integer', 'min:0'],
            'base_end_offset' => ['nullable', 'integer', 'gte:base_start_offset'],

            'insert_after_lemma_id' => ['nullable', Rule::exists('lemmas', 'id')->where('canonical_passage_id', $this->input('canonical_passage_id'))],
            'insert_after_base_offset' => ['nullable', 'integer', 'min:0'],

            'range_start_lemma_id' => ['nullable', Rule::exists('lemmas', 'id')->where('canonical_passage_id', $this->input('canonical_passage_id'))],
            'range_start_base_offset' => ['nullable', 'integer', 'min:0'],
            'range_end_lemma_id' => ['nullable', Rule::exists('lemmas', 'id')->where('canonical_passage_id', $this->input('canonical_passage_id'))],
            'range_end_base_offset' => ['nullable', 'integer', 'gte:range_start_base_offset'],

            'source' => ['required', Rule::in(['transcription', 'existing_conjecture', 'new_conjecture'])],
            // A witness reading placed here becomes a real LemmaReading (the
            // one path that mints one outside PassageAdder), so it is bound
            // by the same rule — see App\Enums\Layer.
            'transcription_layer_id' => ['required_if:source,transcription', Rule::exists('transcription_layers', 'id')->where('layer', Layer::Normalized->value)],
            'start_offset' => ['required_if:source,transcription', 'integer', 'min:0'],
            'end_offset' => ['required_if:source,transcription', 'integer', 'gt:start_offset'],
            'conjecture_id' => [
                'required_if:source,existing_conjecture',
                Rule::exists('conjectures', 'id')->where('canonical_passage_id', $this->input('canonical_passage_id')),
            ],
            ...ConjectureValidationRules::structuralRules('conjecture_'),
            'conjecture_proposed_by' => ['nullable', 'string', 'max:255'],
            'conjecture_bibliography' => ['nullable', 'string'],
            'conjecture_note' => ['nullable', 'string'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $this->validatePlacement($validator);
            $this->validateTranscriptionSpan($validator);
            $this->validateNewConjecture($validator);
            $this->validateExistingConjecture($validator);
        });
    }

    private function validatePlacement(Validator $validator): void
    {
        $placement = $this->input('placement') ?? 'existing';

        if ($placement === 'existing') {
            if ($this->input('lemma_id') === null && ! $this->filled('base_start_offset')) {
                $validator->errors()->add('base_start_offset', 'Missing the target column.');
            }

            if ($this->wantsLacuna()) {
                $validator->errors()->add('source', 'A lacuna is a point insertion, not a word-level column — see placement=insert.');
            } elseif ($this->wantsNewSubstitution()) {
                $validator->errors()->add('placement', 'A brand new substitution is always placed as a range — a single word is just a range of one — see placement=range.');
            }

            return;
        }

        if ($placement === 'range') {
            if ($this->input('range_start_lemma_id') === null && ! $this->filled('range_start_base_offset')) {
                $validator->errors()->add('range_start_base_offset', 'Missing the range\'s starting column.');
            }

            if ($this->input('range_end_lemma_id') === null && ! $this->filled('range_end_base_offset')) {
                $validator->errors()->add('range_end_base_offset', 'Missing the range\'s ending column.');
            }

            // A witness reading normally belongs at an existing column
            // instead, however many words it spans (PassageAligner is what
            // creates that reading, at materialization time) — but a witness
            // can agree word-for-word with its neighbours across a whole
            // conjecture's disputed span, leaving nothing for PassageAligner
            // to have merged automatically. Comparing/adopting that wider
            // reading for the first time is the one place `transcription`
            // belongs here too (see EditionController::witnessExtension).
            if ($this->wantsLacuna()) {
                $validator->errors()->add('conjecture_type', 'A lacuna is a point insertion, not a multi-word range — see placement=insert.');
            } elseif ($this->wantsSupplement()) {
                $validator->errors()->add('conjecture_type', 'A supplement targets its lacuna\'s own column, not a range.');
            }

            return;
        }

        if ($placement === 'new_passage') {
            if ($this->input('source') === 'transcription') {
                $validator->errors()->add('source', 'A whole-line lacuna has no manuscript witness — only a brand new conjecture belongs here.');
            } elseif (! $this->wantsLacuna()) {
                $validator->errors()->add('conjecture_type', 'A new passage is only ever created to house a lacuna.');
            }

            return;
        }

        // insert: never a witness span — there's no existing text to insert
        // "into", and nothing but a lacuna makes sense as a pure insertion.
        if ($this->input('source') === 'transcription') {
            $validator->errors()->add('source', 'Only a lacuna can be inserted this way.');
        } elseif (! $this->wantsLacuna()) {
            $validator->errors()->add('conjecture_type', 'Only a lacuna can be inserted this way.');
        }
    }

    private function wantsLacuna(): bool
    {
        if ($this->input('source') === 'new_conjecture') {
            $type = $this->input('conjecture_type') ?? ConjectureType::Substitution->value;

            return $type === ConjectureType::Lacuna->value;
        }

        if ($this->input('source') === 'existing_conjecture') {
            $conjectureId = $this->input('conjecture_id');
            $conjecture = is_numeric($conjectureId) ? Conjecture::find((int) $conjectureId) : null;

            return $conjecture?->type === ConjectureType::Lacuna;
        }

        return false;
    }

    /**
     * A brand new substitution — single word or many — is always placed as
     * a range now (see placement=range); a range of one lemma is exactly
     * the single-word case, so there's no separate mechanism left for it.
     * Distinct from wantsLacuna()/wantsSupplement(), which still belong
     * under placement=insert/existing respectively.
     */
    private function wantsNewSubstitution(): bool
    {
        if ($this->input('source') !== 'new_conjecture') {
            return false;
        }

        $type = $this->input('conjecture_type') ?? ConjectureType::Substitution->value;

        return $type === ConjectureType::Substitution->value;
    }

    private function wantsSupplement(): bool
    {
        if ($this->input('source') === 'new_conjecture') {
            return $this->input('conjecture_type') === ConjectureType::Supplement->value;
        }

        if ($this->input('source') === 'existing_conjecture') {
            $conjectureId = $this->input('conjecture_id');
            $conjecture = is_numeric($conjectureId) ? Conjecture::find((int) $conjectureId) : null;

            return $conjecture?->type === ConjectureType::Supplement;
        }

        return false;
    }

    private function validateTranscriptionSpan(Validator $validator): void
    {
        if ($this->input('source') !== 'transcription') {
            return;
        }

        $transcriptionId = $this->input('transcription_layer_id');
        $startOffset = $this->input('start_offset');
        $endOffset = $this->input('end_offset');

        if (! is_numeric($transcriptionId) || ! is_numeric($startOffset) || ! is_numeric($endOffset)) {
            return;
        }

        $covered = TranscriptionSegment::where('transcription_layer_id', (int) $transcriptionId)
            ->where('canonical_passage_id', $this->input('canonical_passage_id'))
            ->where('start_offset', '<=', (int) $startOffset)
            ->where('end_offset', '>=', (int) $endOffset)
            ->exists();

        if (! $covered) {
            $validator->errors()->add('start_offset', 'That span isn\'t inside this witness\'s citation of this passage.');
        }
    }

    private function validateNewConjecture(Validator $validator): void
    {
        if ($this->input('source') !== 'new_conjecture') {
            return;
        }

        $type = $this->input('conjecture_type') ?? ConjectureType::Substitution->value;

        if (in_array($type, [ConjectureType::Substitution->value, ConjectureType::Supplement->value], true) && ! $this->filled('conjecture_text')) {
            $validator->errors()->add('conjecture_text', 'This needs proposed text.');
        }

        if ($type === ConjectureType::Lacuna->value && $this->filled('conjecture_text')) {
            $validator->errors()->add('conjecture_text', 'A lacuna never carries its own text — propose a supplement instead.');
        }

        if ($type === ConjectureType::Supplement->value) {
            $lacunaId = $this->input('conjecture_supplements_conjecture_id');

            if (! is_numeric($lacunaId)) {
                $validator->errors()->add('conjecture_supplements_conjecture_id', 'A supplement needs to name which lacuna it fills.');
            }
        }

        if (in_array($type, [ConjectureType::Transposition->value, ConjectureType::Reordering->value], true)) {
            $validator->errors()->add('conjecture_type', 'A transposition or reordering isn\'t placed this way — see edition-transpositions.store / conjecture-orderings.store.');
        }
    }

    /**
     * A supplement picked from the candidate list still has to fill the
     * *same* lacuna the clicked column represents — the controller checks
     * this precisely once the lemma is resolved, but a cheap check here
     * catches an obviously mismatched pick early.
     */
    private function validateExistingConjecture(Validator $validator): void
    {
        if ($this->input('source') !== 'existing_conjecture') {
            return;
        }

        $conjectureId = $this->input('conjecture_id');
        $conjecture = is_numeric($conjectureId) ? Conjecture::find((int) $conjectureId) : null;

        if (in_array($conjecture?->type, [ConjectureType::Transposition, ConjectureType::Reordering], true)) {
            $validator->errors()->add('conjecture_id', 'A transposition or reordering isn\'t placed this way — see edition-transpositions.store / conjecture-orderings.store.');
        }
    }
}
