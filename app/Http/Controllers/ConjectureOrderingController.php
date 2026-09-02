<?php

namespace App\Http\Controllers;

use App\Enums\ConjectureType;
use App\Http\Requests\StoreConjectureOrderingRequest;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\ConjectureOrderingEntry;
use App\Models\Edition;
use App\Models\EditionTransposition;
use App\Support\Edition\PassageOrderRewriter;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;

class ConjectureOrderingController extends Controller
{
    /**
     * Authors a brand-new ConjectureType::Reordering for the submitted
     * sequence, APPLIES it to this edition's stored passage order, and
     * records the application as attribution (EditionTransposition — a
     * Reordering is a Conjecture like a Transposition is, so the same
     * per-edition application record serves both). The conjecture itself
     * joins the same reusable stockpile every other Conjecture does:
     * another edition of the work can apply it too.
     */
    public function store(StoreConjectureOrderingRequest $request, Edition $edition): RedirectResponse
    {
        $orderedIds = $request->validated('canonical_passage_ids');

        DB::transaction(function () use ($request, $edition, $orderedIds) {
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

            PassageOrderRewriter::applySequence($edition, array_values(array_map('intval', $orderedIds)));

            EditionTransposition::firstOrCreate([
                'edition_id' => $edition->id,
                'conjecture_id' => $conjecture->id,
            ]);
        });

        return back();
    }
}
