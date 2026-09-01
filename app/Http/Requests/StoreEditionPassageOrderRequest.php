<?php

namespace App\Http\Requests;

use App\Enums\ConjectureType;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionPassage;
use App\Models\TranscriptionSegment;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreEditionPassageOrderRequest extends FormRequest
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
     * Records this edition's choice of which source's own internal
     * sequence to follow for the range `range_start_canonical_passage_id`
     * through `range_end_canonical_passage_id` (inclusive, by this
     * edition's own position order) — both must already be EditionPassages
     * of this edition. Exactly one of `transcription_layer_id`/`conjecture_id` is
     * given (see withValidator): a transcription must cite *every* passage
     * in the range — a fragmentary witness has no whole-range order to
     * offer, unlike a real witness's own attested reading — and a
     * conjecture must be a ConjectureType::Reordering whose own proposed
     * set matches the range exactly.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return [
            'range_start_canonical_passage_id' => ['required', Rule::exists('edition_passages', 'canonical_passage_id')->where('edition_id', $edition->id)],
            'range_end_canonical_passage_id' => ['required', Rule::exists('edition_passages', 'canonical_passage_id')->where('edition_id', $edition->id)],
            'transcription_layer_id' => ['nullable', 'required_without:conjecture_id', Rule::exists('transcription_layers', 'id')],
            'conjecture_id' => ['nullable', 'required_without:transcription_layer_id', Rule::exists('conjectures', 'id')->where('type', ConjectureType::Reordering->value)],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var Edition $edition */
            $edition = $this->route('edition');

            $startId = $this->input('range_start_canonical_passage_id');
            $endId = $this->input('range_end_canonical_passage_id');

            if (! is_numeric($startId) || ! is_numeric($endId)) {
                return;
            }

            $start = EditionPassage::where('edition_id', $edition->id)->where('canonical_passage_id', (int) $startId)->first();
            $end = EditionPassage::where('edition_id', $edition->id)->where('canonical_passage_id', (int) $endId)->first();

            if ($start === null || $end === null) {
                return;
            }

            if ((float) $end->position < (float) $start->position) {
                $validator->errors()->add('range_end_canonical_passage_id', 'The range must end at or after where it starts.');

                return;
            }

            $rangePassageIds = EditionPassage::where('edition_id', $edition->id)
                ->where('position', '>=', $start->position)
                ->where('position', '<=', $end->position)
                ->pluck('canonical_passage_id');

            $transcriptionId = $this->input('transcription_layer_id');
            $conjectureId = $this->input('conjecture_id');

            if (is_numeric($transcriptionId)) {
                $citedIds = TranscriptionSegment::where('transcription_layer_id', (int) $transcriptionId)
                    ->whereIn('canonical_passage_id', $rangePassageIds)
                    ->pluck('canonical_passage_id')
                    ->unique();

                if ($citedIds->count() !== $rangePassageIds->count()) {
                    $validator->errors()->add('transcription_layer_id', 'That witness doesn\'t cite every passage in this range, so it has no whole-range order to follow here.');
                }

                return;
            }

            if (is_numeric($conjectureId)) {
                $conjecture = Conjecture::find((int) $conjectureId);
                $proposedIds = $conjecture?->orderingEntries->pluck('canonical_passage_id')->sort()->values()->all();
                $expectedIds = $rangePassageIds->sort()->values()->all();

                if ($proposedIds === null || $proposedIds !== $expectedIds) {
                    $validator->errors()->add('conjecture_id', 'That reordering doesn\'t propose an order for exactly this range.');
                }
            }
        });
    }
}
