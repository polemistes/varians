<?php

namespace App\Http\Requests;

use App\Models\BibliographyReference;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class UpdateBibliographyReferenceRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var BibliographyReference $reference */
        $reference = $this->route('reference');

        return $this->user()->can('update', $reference->conjecture_id !== null ? $reference->conjecture : $reference->edition);
    }

    /**
     * Only the notes change on a citation; citing a different item is a
     * different citation.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'prenote' => ['sometimes', 'nullable', 'string', 'max:255'],
            'postnote' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }
}
