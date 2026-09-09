<?php

namespace App\Http\Requests;

use App\Models\BibliographyItem;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

class ImportBibliographyRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        return $this->user()->can('create', BibliographyItem::class);
    }

    /**
     * A .bib file, uploaded or pasted. `replace` lets an entry whose key
     * the list already holds overwrite that item; otherwise it is skipped
     * and reported, since two lists disagreeing about one key is a
     * question for the editor.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'bibtex' => ['nullable', 'string', 'max:2000000'],
            'file' => ['nullable', 'file', 'max:4096'],
            'replace' => ['sometimes', 'boolean'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            if (! $this->filled('bibtex') && ! $this->hasFile('file')) {
                $validator->errors()->add('bibtex', 'Paste biblatex entries or choose a .bib file.');
            }
        });
    }

    /** The text to read, whichever way it came. */
    public function bibtex(): string
    {
        if ($this->hasFile('file')) {
            return (string) file_get_contents($this->file('file')->getRealPath());
        }

        return (string) $this->input('bibtex', '');
    }
}
