<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class UpdateWorkRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Title and author only.
     *
     * The slug is deliberately not editable: it is in the URL of every
     * edition of this work, so changing it would break links that are already
     * out there. Nor is the reference scheme, which every canonical passage's
     * address was built against — changing it would leave those addresses
     * describing a scheme that no longer exists.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:255'],
            'author' => ['nullable', 'string', 'max:255'],
        ];
    }
}
