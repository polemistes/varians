<?php

namespace App\Http\Controllers;

use App\Enums\ConjectureType;
use App\Http\Requests\StoreConjectureOrderingRequest;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\ConjectureOrderingEntry;
use App\Models\Edition;
use App\Support\Bibliography\ReferenceAttacher;
use App\Support\Edition\ArrangementAdopter;
use App\Support\Edition\EditionPublisher;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;

class ConjectureOrderingController extends Controller
{
    /**
     * Authors a brand-new ConjectureType::Reordering for the submitted
     * sequence and — when `follow` is set (the default) — APPLIES it to
     * this edition's stored passage order and records the application as
     * attribution (EditionTransposition — a Reordering is a Conjecture like
     * a Transposition is, so the same per-edition application record serves
     * both). The edition page's "Register transposition conjecture" arrives
     * here too: the editor cut and pasted in the text, and every difference
     * from the stored order is the sequence submitted — as `pieces`, since
     * she may have divided a line, exactly as a witness's citation of a
     * line can stand in two places; adopting such an arrangement prints
     * the line in pieces (ArrangementAdopter). The editor's own
     * arrangement is always a conjecture, never a silent move (user
     * decision). Without `follow` it is only catalogued: a published proposal
     * the editor rejects still belongs in the apparatus, where the order
     * report offers it as a candidate (user decision). The conjecture
     * itself joins the same reusable stockpile every other Conjecture does:
     * another edition of the work can apply it too.
     */
    public function store(StoreConjectureOrderingRequest $request, Edition $edition): RedirectResponse
    {
        $orderedIds = $request->passageIds();
        $pieces = $request->validated('pieces');

        DB::transaction(function () use ($request, $edition, $orderedIds, $pieces) {
            $anchorId = CanonicalPassage::whereIn('id', $orderedIds)->orderBy('sort_key')->value('id');

            $conjecture = Conjecture::create([
                'canonical_passage_id' => $anchorId,
                'user_id' => $request->user()->id,
                'visibility' => EditionPublisher::visibilityForConjectureOn($anchorId),
                'type' => ConjectureType::Reordering,
                'proposed_by' => $request->validated('proposed_by'),
                'note' => $request->validated('note'),
            ]);

            ReferenceAttacher::toConjecture($conjecture, $request->validated('references'));

            // One entry per piece: a whole passage, or a part of one with
            // its words (see ConjectureOrderingEntry).
            $entries = is_array($pieces)
                ? array_map(fn (array $piece) => [
                    'canonical_passage_id' => (int) $piece['canonical_passage_id'],
                    'part' => (int) $piece['part'],
                    'text' => isset($piece['text']) && trim((string) $piece['text']) !== '' ? (string) $piece['text'] : null,
                ], $pieces)
                : array_map(fn (int $id) => ['canonical_passage_id' => $id, 'part' => 1, 'text' => null], $orderedIds);

            foreach (array_values($entries) as $sequence => $entry) {
                ConjectureOrderingEntry::create([
                    'conjecture_id' => $conjecture->id,
                    'sequence' => $sequence,
                    ...$entry,
                ]);
            }

            if (! $request->boolean('follow', true)) {
                return;
            }

            ArrangementAdopter::adopt($edition, $conjecture);
        });

        return back();
    }
}
