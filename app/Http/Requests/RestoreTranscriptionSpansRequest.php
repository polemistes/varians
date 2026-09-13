<?php

namespace App\Http\Requests;

use App\Models\TranscriptionLayer;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class RestoreTranscriptionSpansRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var TranscriptionLayer $transcription */
        $transcription = $this->route('transcription');

        return $this->user()->can('update', $transcription);
    }

    /**
     * Put spans back the way they stood before an undone edit — see
     * TranscriptionSpanRestoreController. `assignments`/`regions` re-create
     * rows the edit deleted; `adjust_assignments`/`adjust_regions` name
     * surviving rows by id and give them their pre-edit bounds back. All
     * offsets are the history's snapshot of what stood before the edit,
     * valid because an undo returns the text to exactly that state.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var TranscriptionLayer $transcription */
        $transcription = $this->route('transcription');

        return [
            'assignments' => ['array'],
            'assignments.*.segment_id' => ['required', 'integer', Rule::exists('segments', 'id')],
            'assignments.*.start_offset' => ['required', 'integer', 'min:0'],
            'assignments.*.end_offset' => ['required', 'integer', 'min:0'],
            'assignments.*.part' => ['required', 'integer', 'min:1'],
            'regions' => ['array'],
            'regions.*.manuscript_image_id' => ['required', 'integer', Rule::exists('manuscript_images', 'id')],
            'regions.*.start_offset' => ['required', 'integer', 'min:0'],
            'regions.*.end_offset' => ['required', 'integer', 'min:0'],
            'regions.*.position' => ['required', 'integer', 'min:0'],
            'regions.*.x' => ['required', 'numeric'],
            'regions.*.y' => ['required', 'numeric'],
            'regions.*.width' => ['required', 'numeric'],
            'regions.*.height' => ['required', 'numeric'],
            'adjust_assignments' => ['array'],
            'adjust_assignments.*.id' => ['required', 'integer', Rule::exists('assignments', 'id')->where('transcription_layer_id', $transcription->id)],
            'adjust_assignments.*.start_offset' => ['required', 'integer', 'min:0'],
            'adjust_assignments.*.end_offset' => ['required', 'integer', 'min:0'],
            'adjust_assignments.*.needs_review' => ['sometimes', 'boolean'],
            'adjust_regions' => ['array'],
            'adjust_regions.*.id' => ['required', 'integer', Rule::exists('transcription_regions', 'id')->where('transcription_layer_id', $transcription->id)],
            'adjust_regions.*.start_offset' => ['required', 'integer', 'min:0'],
            'adjust_regions.*.end_offset' => ['required', 'integer', 'min:0'],
            'adjust_regions.*.needs_review' => ['sometimes', 'boolean'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var TranscriptionLayer $transcription */
            $transcription = $this->route('transcription');
            $length = mb_strlen($transcription->text);

            $lists = [
                'assignments' => (array) $this->input('assignments', []),
                'regions' => (array) $this->input('regions', []),
                'adjust_assignments' => (array) $this->input('adjust_assignments', []),
                'adjust_regions' => (array) $this->input('adjust_regions', []),
            ];

            if (array_filter($lists) === []) {
                $validator->errors()->add('assignments', 'Nothing to restore.');
            }

            foreach ($lists as $key => $rows) {
                foreach ($rows as $index => $row) {
                    $start = $row['start_offset'] ?? null;
                    $end = $row['end_offset'] ?? null;

                    if (! is_numeric($start) || ! is_numeric($end)) {
                        continue; // already reported by the declarative rules
                    }

                    if ((int) $end <= (int) $start || (int) $end > $length) {
                        $validator->errors()->add(
                            "{$key}.{$index}.end_offset",
                            'A restored span must cover existing text.',
                        );
                    }
                }
            }
        });
    }
}
