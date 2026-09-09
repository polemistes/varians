<?php

namespace App\Http\Requests;

use App\Models\EditionComment;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class UpdateEditionCommentRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var EditionComment $comment */
        $comment = $this->route('comment');

        return $this->user()->can('update', $comment->edition);
    }

    /**
     * Only the wording is editable. Moving a note to a different passage or
     * column is not an edit but a different note — delete it and write one
     * where it belongs, rather than silently reanchoring an argument someone
     * may have cited.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'note' => ['required', 'string', 'max:5000'],
        ];
    }
}
