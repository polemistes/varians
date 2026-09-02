<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * A manuscript can transpose text in a way that cuts across the work's
     * segmentation — half of line 40 standing where line 42 belongs — so one
     * canonical passage's witness text can be physically discontinuous:
     * several spans in one layer citing the same passage. `part` records the
     * *content* order of those spans (which fragment is the first half of the
     * line), a claim independent of the physical order their offsets give,
     * since the two disagreeing is exactly what a transposition is.
     */
    public function up(): void
    {
        Schema::table('transcription_segments', function (Blueprint $table) {
            $table->unsignedSmallInteger('part')->default(1);
        });

        // Existing same-(layer, passage) duplicates get parts 1..n in physical
        // order — the only order anything has consumed so far.
        $duplicates = DB::table('transcription_segments')
            ->select('transcription_layer_id', 'canonical_passage_id')
            ->groupBy('transcription_layer_id', 'canonical_passage_id')
            ->havingRaw('COUNT(*) > 1')
            ->get();

        foreach ($duplicates as $duplicate) {
            $ids = DB::table('transcription_segments')
                ->where('transcription_layer_id', $duplicate->transcription_layer_id)
                ->where('canonical_passage_id', $duplicate->canonical_passage_id)
                ->orderBy('start_offset')
                ->pluck('id');

            foreach ($ids as $index => $id) {
                DB::table('transcription_segments')->where('id', $id)->update(['part' => $index + 1]);
            }
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('transcription_segments', function (Blueprint $table) {
            $table->dropColumn('part');
        });
    }
};
