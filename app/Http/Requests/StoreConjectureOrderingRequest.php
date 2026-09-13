<?php

namespace App\Http\Requests;

use App\Models\Edition;
use App\Models\EditionSegment;
use App\Support\Bibliography\ReferenceRules;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreConjectureOrderingRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return $this->user()->can('update', $edition);
    }

    /**
     * Authors a brand-new ConjectureType::Reordering proposing
     * `segment_ids` be read in exactly the given order — every id
     * must already be an EditionSegment of this edition, with no
     * duplicates, and together they must form one contiguous range of the
     * NUMBERING order, nothing left out (see withValidator). A reordering
     * proposal is a statement about a stretch of the work ("lines 6–7"),
     * so numbering order defines its extent — not whatever printed order
     * the editor happens to have arranged at the moment, which may have
     * scattered the stretch. The conjecture itself is edition-independent,
     * exactly like every other Conjecture.
     *
     * Either `segment_ids` (whole segments, the order panel's
     * form) or `pieces` (the edition text's cut and paste, which may divide
     * a segment into parts, which the edition then prints in pieces when
     * it adopts the arrangement — see ArrangementAdopter).
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return [
            'segment_ids' => ['required_without:pieces', 'array', 'min:2'],
            'segment_ids.*' => ['distinct', 'integer', Rule::exists('edition_segments', 'segment_id')->where('edition_id', $edition->id)],
            // The edition page's cut-and-paste form: pieces in proposed
            // order, a segment possibly divided (see ConjectureOrderingEntry).
            'pieces' => ['required_without:segment_ids', 'array', 'min:2'],
            'pieces.*.segment_id' => ['required', 'integer', Rule::exists('edition_segments', 'segment_id')->where('edition_id', $edition->id)],
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
            $ids = $this->segmentIds();

            if ($ids === []) {
                return;
            }

            $this->validatePieces($validator);

            $segments = EditionSegment::where('edition_id', $edition->id)
                ->whereIn('segment_id', $ids)
                ->with('segment:id,sort_key')
                ->get();

            if ($segments->count() !== count($ids)) {
                return; // already reported by the per-item exists rule
            }

            $sortKeys = $segments->map(fn (EditionSegment $segment) => $segment->segment->sort_key);

            $spanCount = EditionSegment::where('edition_id', $edition->id)
                ->whereHas('segment', fn ($query) => $query
                    ->where('sort_key', '>=', $sortKeys->min())
                    ->where('sort_key', '<=', $sortKeys->max()))
                ->count();

            if ($spanCount !== count($ids)) {
                $validator->errors()->add($this->has('pieces') ? 'pieces' : 'segment_ids', 'These segments must form one contiguous range of the numbering order, with nothing left out.');
            }
        });
    }

    /**
     * The segments proposed, each once, in proposed order.
     *
     * @return list<int>
     */
    public function segmentIds(): array
    {
        $pieces = $this->input('pieces');

        if (is_array($pieces)) {
            $ids = [];

            foreach ($pieces as $piece) {
                if (is_array($piece) && is_numeric($piece['segment_id'] ?? null)) {
                    $ids[] = (int) $piece['segment_id'];
                }
            }

            return array_values(array_unique($ids));
        }

        $ids = $this->input('segment_ids');

        return is_array($ids) ? array_values(array_map('intval', $ids)) : [];
    }

    /**
     * Whether any segment is divided into parts.
     */
    public function dividesSegments(): bool
    {
        $pieces = $this->input('pieces');

        if (! is_array($pieces)) {
            return false;
        }

        $counts = [];

        foreach ($pieces as $piece) {
            $id = is_array($piece) ? ($piece['segment_id'] ?? null) : null;
            $counts[$id] = ($counts[$id] ?? 0) + 1;
        }

        return $counts !== [] && max($counts) > 1;
    }

    /**
     * A divided segment must be complete — parts 1..n each exactly once,
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

            $parts[$piece['segment_id'] ?? 0][] = (int) ($piece['part'] ?? 0);

            if (($piece['part'] ?? 1) > 1 || count($parts[$piece['segment_id'] ?? 0]) > 1) {
                if (trim((string) ($piece['text'] ?? '')) === '') {
                    $validator->errors()->add('pieces', 'Each part of a divided segment needs its words.');
                }
            }
        }

        foreach ($parts as $segmentParts) {
            sort($segmentParts);

            if ($segmentParts !== range(1, count($segmentParts))) {
                $validator->errors()->add('pieces', 'A divided segment must be complete: every part once, in order.');

                return;
            }
        }
    }
}
