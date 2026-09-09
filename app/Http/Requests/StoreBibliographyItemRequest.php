<?php

namespace App\Http\Requests;

use App\Models\BibliographyItem;
use App\Support\Bibliography\Biblatex;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreBibliographyItemRequest extends FormRequest
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
     * One biblatex entry: a type from the standard set, an optional key
     * (generated from the label when omitted), and a map of biblatex fields
     * to values — only names the registry knows, since the list exists to
     * export as a .bib file nothing has to translate. A title is required,
     * as biblatex itself requires one for nearly every type; empty values
     * are dropped rather than stored.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'entry_type' => ['required', Rule::in(Biblatex::types())],
            'citation_key' => ['nullable', 'string', 'max:120', 'regex:/^[A-Za-z0-9_:.\-]+$/', $this->uniqueKey()],
            'fields' => ['required', 'array'],
            'fields.*' => ['nullable', 'string', 'max:5000'],
            'fields.title' => ['required', 'string', 'max:5000'],
        ];
    }

    protected function uniqueKey(): mixed
    {
        return Rule::unique('bibliography_items', 'citation_key');
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $fields = $this->input('fields');

            if (! is_array($fields)) {
                return;
            }

            foreach (array_keys($fields) as $name) {
                if (! is_string($name) || ! Biblatex::isField($name)) {
                    $validator->errors()->add('fields', '“'.$name.'” is not a biblatex field.');
                }
            }

            foreach ($fields as $name => $value) {
                if (is_string($value) && substr_count($value, '{') !== substr_count($value, '}')) {
                    $validator->errors()->add('fields.'.$name, 'Braces must balance — biblatex cannot read an unbalanced value.');
                }
            }
        });
    }

    /**
     * The fields worth storing: registry names only, blanks dropped, in
     * the registry's own order so an entry always reads the same way.
     *
     * @return array<string, string>
     */
    public function cleanFields(): array
    {
        $given = (array) $this->validated('fields');
        $clean = [];

        foreach (Biblatex::fieldNames() as $name) {
            $value = $given[$name] ?? null;

            if (is_string($value) && trim($value) !== '') {
                $clean[$name] = trim($value);
            }
        }

        return $clean;
    }
}
