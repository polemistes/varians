<?php

namespace App\Http\Requests;

use App\Models\Edition;
use App\Models\EditionPassage;
use App\Support\Bibliography\ReferenceRules;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreConjectureOrderingRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Authors a brand-new ConjectureType::Reordering proposing
     * `canonical_passage_ids` be read in exactly the given order — every id
     * must already be an EditionPassage of this edition, with no
     * duplicates, and together they must form one contiguous range of the
     * CITATION order, nothing left out (see withValidator). A reordering
     * proposal is a statement about a stretch of the work ("lines 6–7"),
     * so citation order defines its extent — not whatever printed order
     * the editor happens to have arranged at the moment, which may have
     * scattered the stretch. The conjecture itself is edition-independent,
     * exactly like every other Conjecture.
     *
     * Either `canonical_passage_ids` (whole passages, the order panel's
     * form) or `pieces` (the edition text's cut and paste, which may divide
     * a passage into parts, which the edition then prints in pieces when
     * it adopts the arrangement — see ArrangementAdopter).
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return [
            'canonical_passage_ids' => ['required_without:pieces', 'array', 'min:2'],
            'canonical_passage_ids.*' => ['distinct', 'integer', Rule::exists('edition_passages', 'canonical_passage_id')->where('edition_id', $edition->id)],
            // The edition page's cut-and-paste form: pieces in proposed
            // order, a passage possibly divided (see ConjectureOrderingEntry).
            'pieces' => ['required_without:canonical_passage_ids', 'array', 'min:2'],
            'pieces.*.canonical_passage_id' => ['required', 'integer', Rule::exists('edition_passages', 'canonical_passage_id')->where('edition_id', $edition->id)],
            'pieces.*.part' => ['required', 'integer', 'min:1'],
            'pieces.*.text' => ['nullable', 'string'],
            'proposed_by' => ['nullable', 'string', 'max:255'],
            ...ReferenceRules::rules('references'),
            'note' => ['nullable', 'string'],
            // Apply and adopt (default), or only catalogue as a candidate.
            'follow' => ['sometimes', 'boolean'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var Edition $edition */
            $edition = $this->route('edition');
            $ids = $this->passageIds();

            if ($ids === []) {
                return;
            }

            $this->validatePieces($validator);

            $passages = EditionPassage::where('edition_id', $edition->id)
                ->whereIn('canonical_passage_id', $ids)
                ->with('canonicalPassage:id,sort_key')
                ->get();

            if ($passages->count() !== count($ids)) {
                return; // already reported by the per-item exists rule
            }

            $sortKeys = $passages->map(fn (EditionPassage $passage) => $passage->canonicalPassage->sort_key);

            $spanCount = EditionPassage::where('edition_id', $edition->id)
                ->whereHas('canonicalPassage', fn ($query) => $query
                    ->where('sort_key', '>=', $sortKeys->min())
                    ->where('sort_key', '<=', $sortKeys->max()))
                ->count();

            if ($spanCount !== count($ids)) {
                $validator->errors()->add($this->has('pieces') ? 'pieces' : 'canonical_passage_ids', 'These passages must form one contiguous range of the citation order, with nothing left out.');
            }
        });
    }

    /**
     * The passages proposed, each once, in proposed order.
     *
     * @return list<int>
     */
    public function passageIds(): array
    {
        $pieces = $this->input('pieces');

        if (is_array($pieces)) {
            $ids = [];

            foreach ($pieces as $piece) {
                if (is_array($piece) && is_numeric($piece['canonical_passage_id'] ?? null)) {
                    $ids[] = (int) $piece['canonical_passage_id'];
                }
            }

            return array_values(array_unique($ids));
        }

        $ids = $this->input('canonical_passage_ids');

        return is_array($ids) ? array_values(array_map('intval', $ids)) : [];
    }

    /**
     * Whether any passage is divided into parts.
     */
    public function dividesPassages(): bool
    {
        $pieces = $this->input('pieces');

        if (! is_array($pieces)) {
            return false;
        }

        $counts = [];

        foreach ($pieces as $piece) {
            $id = is_array($piece) ? ($piece['canonical_passage_id'] ?? null) : null;
            $counts[$id] = ($counts[$id] ?? 0) + 1;
        }

        return $counts !== [] && max($counts) > 1;
    }

    /**
     * A divided passage must be complete — parts 1..n each exactly once,
     * each with its words.
     */
    private function validatePieces(Validator $validator): void
    {
        $pieces = $this->input('pieces');

        if (! is_array($pieces)) {
            return;
        }

        $parts = [];

        foreach ($pieces as $piece) {
            if (! is_array($piece)) {
                continue;
            }

            $parts[$piece['canonical_passage_id'] ?? 0][] = (int) ($piece['part'] ?? 0);

            if (($piece['part'] ?? 1) > 1 || count($parts[$piece['canonical_passage_id'] ?? 0]) > 1) {
                if (trim((string) ($piece['text'] ?? '')) === '') {
                    $validator->errors()->add('pieces', 'Each part of a divided passage needs its words.');
                }
            }
        }

        foreach ($parts as $passageParts) {
            sort($passageParts);

            if ($passageParts !== range(1, count($passageParts))) {
                $validator->errors()->add('pieces', 'A divided passage must be complete: every part once, in order.');

                return;
            }
        }
    }
}
