<?php

namespace App\Http\Requests;

use App\Models\ManuscriptImage;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class StoreManuscriptImageFeatureRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var ManuscriptImage $image */
        $image = $this->route('image');

        return $this->user()->can('update', $image->witness);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'label' => ['required', 'string', 'max:255'],
            'x' => ['required', 'numeric', 'between:0,1'],
            'y' => ['required', 'numeric', 'between:0,1'],
            'width' => ['required', 'numeric', 'between:0,1'],
            'height' => ['required', 'numeric', 'between:0,1'],
        ];
    }
}
