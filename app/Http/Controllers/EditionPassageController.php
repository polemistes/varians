<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreEditionPassageRequest;
use App\Http\Requests\StoreEditionPassagesBulkRequest;
use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\EditionPassage;
use App\Models\TranscriptionSegment;
use App\Support\Edition\LineationSeeder;
use App\Support\Edition\PassageAdder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Collection as SupportCollection;
use Illuminate\Support\Facades\DB;

class EditionPassageController extends Controller
{
    /**
     * Add every already-cited segment fully inside a raw drag-selected span
     * to the edition, in the transcription's own physical order.
     */
    public function store(StoreEditionPassageRequest $request, Edition $edition): RedirectResponse
    {
        $segments = TranscriptionSegment::where('transcription_layer_id', $request->validated('transcription_layer_id'))
            ->where('start_offset', '>=', $request->validated('start_offset'))
            ->where('end_offset', '<=', $request->validated('end_offset'))
            ->orderBy('start_offset')
            ->get();

        $this->addSegments($edition, $segments);

        return back();
    }

    /**
     * "Base a range on this manuscript" — every already-cited segment for
     * the transcription within a citation range, added in the
     * transcription's own physical order, not citation order. This is the
     * whole point of the redesign: a scribal displacement lands where the
     * manuscript actually has it.
     */
    public function storeBulk(StoreEditionPassagesBulkRequest $request, Edition $edition): RedirectResponse
    {
        $from = CanonicalPassage::findOrFail((int) $request->validated('from_canonical_passage_id'));
        $to = CanonicalPassage::findOrFail((int) $request->validated('to_canonical_passage_id'));

        $segments = TranscriptionSegment::where('transcription_layer_id', $request->validated('transcription_layer_id'))
            ->whereHas('canonicalPassage', fn ($query) => $query
                ->where('work_id', $edition->work_id)
                ->where('sort_key', '>=', $from->sort_key)
                ->where('sort_key', '<=', $to->sort_key))
            ->get()
            ->sortBy(fn (TranscriptionSegment $segment) => $segment->start_offset)
            ->values();

        $this->addSegments($edition, $segments);

        return back();
    }

    /**
     * Removing a passage never touches Lemma/LemmaReading/Conjecture (all
     * edition-independent shared collation) or EditionTransposition (an
     * applied proposal's attribution record — the Conjecture is part of a
     * reusable stockpile any edition of the work can draw on, never
     * entangled with any one edition's own passage lifecycle). This
     * edition's own selections for the passage's lemmas are cleared. The
     * passage becomes available again in every transcription citing it,
     * for free.
     */
    public function destroy(EditionPassage $editionPassage): RedirectResponse
    {
        DB::transaction(function () use ($editionPassage) {
            EditionLemma::where('edition_id', $editionPassage->edition_id)
                ->whereHas('lemma', fn ($query) => $query->where('canonical_passage_id', $editionPassage->canonical_passage_id))
                ->delete();

            $editionPassage->delete();
        });

        return back();
    }

    /**
     * @param  SupportCollection<int, TranscriptionSegment>  $segments
     */
    private function addSegments(Edition $edition, SupportCollection $segments): void
    {
        DB::transaction(function () use ($edition, $segments) {
            $position = (float) (EditionPassage::where('edition_id', $edition->id)->lockForUpdate()->max('position') ?? 0);
            $previous = null;

            foreach ($segments as $segment) {
                PassageAdder::add(
                    $edition,
                    $segment,
                    $position += 1.0,
                    LineationSeeder::interPassageFlags($previous, $segment),
                );

                $previous = $segment;
            }
        });
    }
}
