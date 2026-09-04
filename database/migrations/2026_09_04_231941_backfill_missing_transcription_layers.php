<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Every transcription carries BOTH layers — the app has created the pair at
 * once for a long time ("both layers are created at once"), and the witness
 * workbench now gives each layer a fixed pane (diplomatic left, normalized
 * right). Transcriptions from before the pair-at-once flow could still hold
 * a single layer, leaving one pane with nothing to show; give them the
 * missing side, empty, owned by whoever owns the side that exists.
 */
return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        foreach (DB::table('transcriptions')->pluck('id') as $transcriptionId) {
            $layers = DB::table('transcription_layers')
                ->where('transcription_id', $transcriptionId)
                ->get(['layer', 'user_id']);

            foreach (['diplomatic', 'normalized'] as $side) {
                if ($layers->contains('layer', $side)) {
                    continue;
                }

                DB::table('transcription_layers')->insert([
                    'transcription_id' => $transcriptionId,
                    'user_id' => $layers->first()?->user_id,
                    'layer' => $side,
                    'text' => '',
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }
    }

    public function down(): void
    {
        // The created rows are indistinguishable from deliberately empty
        // layers by now; removing them could destroy later work. One-way.
    }
};
