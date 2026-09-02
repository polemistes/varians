<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * The stored `edition_passages.position` becomes the printed order.
     * Until now the rendered order was computed per request in two phases —
     * adopted transposition conjectures relocated ranges, then
     * `edition_passage_orders` resequenced ranges in place — with positions
     * frozen at add time. This migration replays exactly that composition
     * once (ported from the retired EditionController machinery), writes the
     * final order back as positions 1..n per edition, and drops the
     * `edition_passage_orders` table. `edition_transpositions` rows survive
     * as pure attribution ("this edition applied this proposal"); they stop
     * affecting rendering.
     */
    public function up(): void
    {
        foreach (DB::table('editions')->pluck('id') as $editionId) {
            $ordered = $this->finalOrder((int) $editionId);

            foreach ($ordered as $index => $row) {
                DB::table('edition_passages')
                    ->where('id', $row->id)
                    ->update(['position' => $index + 1]);
            }
        }

        Schema::dropIfExists('edition_passage_orders');
    }

    /**
     * Reverse the migrations.
     *
     * The composed order cannot be un-composed; positions simply stay
     * materialized. Only the dropped table is recreated, empty.
     */
    public function down(): void
    {
        Schema::create('edition_passage_orders', function ($table) {
            $table->id();
            $table->foreignId('edition_id')->constrained()->cascadeOnDelete();
            $table->foreignId('range_start_canonical_passage_id')->constrained('canonical_passages')->cascadeOnDelete();
            $table->foreignId('range_end_canonical_passage_id')->constrained('canonical_passages')->cascadeOnDelete();
            $table->foreignId('transcription_layer_id')->nullable()->constrained('transcription_layers')->cascadeOnDelete();
            $table->foreignId('conjecture_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['edition_id', 'range_start_canonical_passage_id', 'range_end_canonical_passage_id'], 'edition_passage_orders_range_unique');
        });
    }

    /**
     * The edition's passages in final rendered order — position order, then
     * phase 1 (relocations, in adoption order), then phase 2 (in-place
     * resequencing).
     *
     * @return array<int, stdClass>
     */
    private function finalOrder(int $editionId): array
    {
        $ordered = DB::table('edition_passages')
            ->where('edition_id', $editionId)
            ->orderBy('position')
            ->get(['id', 'canonical_passage_id', 'position'])
            ->values()
            ->all();

        $moves = DB::table('edition_transpositions')
            ->join('conjectures', 'conjectures.id', '=', 'edition_transpositions.conjecture_id')
            ->where('edition_transpositions.edition_id', $editionId)
            ->orderBy('conjectures.created_at')
            ->get([
                'conjectures.canonical_passage_id',
                'conjectures.transposition_range_end_canonical_passage_id',
                'conjectures.move_target_canonical_passage_id',
                'conjectures.move_position',
            ]);

        foreach ($moves as $move) {
            $ordered = $this->moveRange($ordered, $move);
        }

        $passageOrders = DB::table('edition_passage_orders')
            ->where('edition_id', $editionId)
            ->get();

        foreach ($passageOrders as $passageOrder) {
            $ordered = $this->applyPassageOrder($ordered, $passageOrder);
        }

        return $ordered;
    }

    /**
     * @param  array<int, stdClass>  $passages
     * @return array<int, stdClass>
     */
    private function moveRange(array $passages, stdClass $move): array
    {
        if ($move->move_target_canonical_passage_id === null || $move->move_position === null) {
            return $passages;
        }

        $rangeEndId = $move->transposition_range_end_canonical_passage_id ?? $move->canonical_passage_id;
        $from = null;
        $to = null;

        foreach ($passages as $passage) {
            if ($passage->canonical_passage_id === $move->canonical_passage_id) {
                $from = (float) $passage->position;
            }

            if ($passage->canonical_passage_id === $rangeEndId) {
                $to = (float) $passage->position;
            }
        }

        if ($from === null || $to === null) {
            return $passages;
        }

        if ($to < $from) {
            [$from, $to] = [$to, $from];
        }

        $moved = [];
        $remaining = [];

        foreach ($passages as $passage) {
            $position = (float) $passage->position;

            if ($position >= $from && $position <= $to) {
                $moved[] = $passage;
            } else {
                $remaining[] = $passage;
            }
        }

        $targetIndex = null;

        foreach ($remaining as $index => $passage) {
            if ($passage->canonical_passage_id === $move->move_target_canonical_passage_id) {
                $targetIndex = $index;

                break;
            }
        }

        if ($targetIndex === null) {
            return $passages;
        }

        array_splice($remaining, $move->move_position === 'before' ? $targetIndex : $targetIndex + 1, 0, $moved);

        return $remaining;
    }

    /**
     * @param  array<int, stdClass>  $passages
     * @return array<int, stdClass>
     */
    private function applyPassageOrder(array $passages, stdClass $passageOrder): array
    {
        $start = null;
        $end = null;

        foreach ($passages as $passage) {
            if ($passage->canonical_passage_id === $passageOrder->range_start_canonical_passage_id) {
                $start = (float) $passage->position;
            }

            if ($passage->canonical_passage_id === $passageOrder->range_end_canonical_passage_id) {
                $end = (float) $passage->position;
            }
        }

        if ($start === null || $end === null) {
            return $passages;
        }

        if ($end < $start) {
            [$start, $end] = [$end, $start];
        }

        $spanIndexes = [];
        $spanIds = [];

        foreach ($passages as $index => $passage) {
            $position = (float) $passage->position;

            if ($position >= $start && $position <= $end) {
                $spanIndexes[] = $index;
                $spanIds[] = $passage->canonical_passage_id;
            }
        }

        $sequence = $this->orderSequence($passageOrder, $spanIds);

        if ($sequence === null) {
            return $passages;
        }

        $byId = [];

        foreach ($spanIndexes as $index) {
            $byId[$passages[$index]->canonical_passage_id] = $passages[$index];
        }

        foreach ($spanIndexes as $slot => $index) {
            $passages[$index] = $byId[$sequence[$slot]];
        }

        return $passages;
    }

    /**
     * @param  list<int>  $spanIds
     * @return list<int>|null
     */
    private function orderSequence(stdClass $passageOrder, array $spanIds): ?array
    {
        if ($passageOrder->conjecture_id !== null) {
            $sequence = DB::table('conjecture_ordering_entries')
                ->where('conjecture_id', $passageOrder->conjecture_id)
                ->orderBy('sequence')
                ->pluck('canonical_passage_id')
                ->map(fn ($id) => (int) $id)
                ->all();
        } elseif ($passageOrder->transcription_layer_id !== null) {
            $sequence = DB::table('transcription_segments')
                ->where('transcription_layer_id', $passageOrder->transcription_layer_id)
                ->whereIn('canonical_passage_id', $spanIds)
                ->orderBy('start_offset')
                ->pluck('canonical_passage_id')
                ->map(fn ($id) => (int) $id)
                ->unique()
                ->values()
                ->all();
        } else {
            return null;
        }

        $sequence = array_values($sequence);

        $sortedSequence = $sequence;
        sort($sortedSequence);
        $sortedExpected = $spanIds;
        sort($sortedExpected);

        return $sortedSequence === $sortedExpected ? $sequence : null;
    }
};
