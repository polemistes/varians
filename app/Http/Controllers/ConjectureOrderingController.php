<?php

namespace App\Http\Controllers;

use App\Enums\ConjectureType;
use App\Http\Requests\StoreConjectureOrderingRequest;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\ConjectureOrderingEntry;
use App\Models\Edition;
use App\Models\EditionPassage;
use App\Models\EditionPassageOrder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;

class ConjectureOrderingController extends Controller
{
    /**
     * Authors a brand-new ConjectureType::Reordering for the submitted
     * sequence and immediately selects it for this edition — mirrors
     * EditionTranspositionController::store creating a Conjecture and
     * adopting it in one step, since a reordering's own range only means
     * anything relative to the edition it was authored against, even
     * though the conjecture itself joins the same reusable stockpile every
     * other Conjecture does (another edition of the work can select it too).
     */
    public function store(StoreConjectureOrderingRequest $request, Edition $edition): RedirectResponse
    {
        $orderedIds = $request->validated('canonical_passage_ids');

        DB::transaction(function () use ($request, $edition, $orderedIds) {
            $passagesByPosition = EditionPassage::where('edition_id', $edition->id)
                ->whereIn('canonical_passage_id', $orderedIds)
                ->orderBy('position')
                ->get();

            $anchorId = CanonicalPassage::whereIn('id', $orderedIds)->orderBy('sort_key')->value('id');

            $conjecture = Conjecture::create([
                'canonical_passage_id' => $anchorId,
                'user_id' => $request->user()->id,
                'type' => ConjectureType::Reordering,
                'proposed_by' => $request->validated('proposed_by'),
                'bibliography' => $request->validated('bibliography'),
                'note' => $request->validated('note'),
            ]);

            foreach ($orderedIds as $sequence => $canonicalPassageId) {
                ConjectureOrderingEntry::create([
                    'conjecture_id' => $conjecture->id,
                    'canonical_passage_id' => $canonicalPassageId,
                    'sequence' => $sequence,
                ]);
            }

            EditionPassageOrder::updateOrCreate(
                [
                    'edition_id' => $edition->id,
                    'range_start_canonical_passage_id' => $passagesByPosition->first()->canonical_passage_id,
                    'range_end_canonical_passage_id' => $passagesByPosition->last()->canonical_passage_id,
                ],
                [
                    'transcription_layer_id' => null,
                    'conjecture_id' => $conjecture->id,
                    'user_id' => $request->user()->id,
                ],
            );
        });

        return back();
    }
}
