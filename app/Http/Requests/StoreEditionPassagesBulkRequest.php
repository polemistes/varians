<?php

namespace App\Http\Requests;

use App\Enums\Layer;
use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\TranscriptionSegment;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreEditionPassagesBulkRequest extends FormRequest
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
     * "Base a range on this manuscript" — the bulk add. Both endpoints are
     * picked from the work's own passage list (a hierarchical dropdown, not
     * free text), so they're always real, existing passages of this
     * edition's work. Unlike the old EditionBase range, no overlap check:
     * PassageAdder's own "already added" guard is the only conflict
     * resolution needed, so a second bulk add over the same (or an
     * overlapping) citation range from a different transcription simply
     * no-ops on whatever the first one already claimed.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return [
            // Only the normalized layer collates and only it may be a base —
            // see App\Enums\Layer.
            'transcription_layer_id' => ['required', Rule::exists('transcription_layers', 'id')->where('layer', Layer::Normalized->value)],
            'from_canonical_passage_id' => ['required', Rule::exists('canonical_passages', 'id')->where('work_id', $edition->work_id)],
            'to_canonical_passage_id' => ['required', Rule::exists('canonical_passages', 'id')->where('work_id', $edition->work_id)],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var Edition $edition */
            $edition = $this->route('edition');

            $transcriptionId = $this->input('transcription_layer_id');

            if (is_numeric($transcriptionId)) {
                $belongsToWork = TranscriptionSegment::where('transcription_layer_id', (int) $transcriptionId)
                    ->whereHas('canonicalPassage', fn ($query) => $query->where('work_id', $edition->work_id))
                    ->exists();

                if (! $belongsToWork) {
                    $validator->errors()->add('transcription_layer_id', 'That transcription has no citations in this work.');
                }
            }

            $fromId = $this->input('from_canonical_passage_id');
            $toId = $this->input('to_canonical_passage_id');

            if (! is_numeric($fromId) || ! is_numeric($toId)) {
                return;
            }

            $from = CanonicalPassage::find((int) $fromId);
            $to = CanonicalPassage::find((int) $toId);

            if ($from !== null && $to !== null && $from->sort_key > $to->sort_key) {
                $validator->errors()->add('to_canonical_passage_id', 'The range must end at or after where it starts.');
            }
        });
    }
}
