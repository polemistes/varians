<?php

namespace App\Http\Requests;

use App\Models\TranscriptionRegion;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class UpdateTranscriptionRegionRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var TranscriptionRegion $region */
        $region = $this->route('region');

        return $this->user()->can('update', $region->transcriptionLayer);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * Only the box geometry is editable — the text/offset span a region
     * covers is fixed at creation; redraw a new region instead if that's
     * wrong.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'x' => ['required', 'numeric', 'between:0,1'],
            'y' => ['required', 'numeric', 'between:0,1'],
            'width' => ['required', 'numeric', 'between:0,1'],
            'height' => ['required', 'numeric', 'between:0,1'],
        ];
    }
}
