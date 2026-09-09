<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Works and witnesses get an owner, like editions and conjectures already
 * have. Until now everything was collaboratively editable by any editor, so
 * neither recorded who made it; the owner is reconstructed from the nearest
 * thing that did — an edition's owner for a work, a transcription layer's
 * author for a witness — and falls back to the first administrator, so
 * nothing is left ownerless on an existing site.
 *
 * Nullable, and nulled if the owner's account goes: a manuscript's
 * transcription must outlive the account that registered it, for an
 * administrator to hand on.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('works', function (Blueprint $table) {
            $table->foreignId('user_id')->nullable()->after('id')->constrained()->nullOnDelete();
        });

        Schema::table('witnesses', function (Blueprint $table) {
            $table->foreignId('user_id')->nullable()->after('id')->constrained()->nullOnDelete();
        });

        $fallback = DB::table('users')->where('role', 'administrator')->orderBy('id')->value('id')
            ?? DB::table('users')->orderBy('id')->value('id');

        foreach (DB::table('works')->orderBy('id')->get(['id']) as $work) {
            $owner = DB::table('editions')->where('work_id', $work->id)->orderBy('id')->value('user_id')
                ?? DB::table('transcription_layers')
                    ->join('transcription_segments', 'transcription_segments.transcription_layer_id', '=', 'transcription_layers.id')
                    ->join('canonical_passages', 'canonical_passages.id', '=', 'transcription_segments.canonical_passage_id')
                    ->where('canonical_passages.work_id', $work->id)
                    ->orderBy('transcription_layers.id')
                    ->value('transcription_layers.user_id')
                ?? $fallback;

            DB::table('works')->where('id', $work->id)->update(['user_id' => $owner]);
        }

        foreach (DB::table('witnesses')->orderBy('id')->get(['id']) as $witness) {
            $owner = DB::table('transcription_layers')
                ->join('transcriptions', 'transcriptions.id', '=', 'transcription_layers.transcription_id')
                ->where('transcriptions.witness_id', $witness->id)
                ->orderBy('transcription_layers.id')
                ->value('transcription_layers.user_id')
                ?? $fallback;

            DB::table('witnesses')->where('id', $witness->id)->update(['user_id' => $owner]);
        }
    }

    public function down(): void
    {
        Schema::table('witnesses', function (Blueprint $table) {
            $table->dropConstrainedForeignId('user_id');
        });

        Schema::table('works', function (Blueprint $table) {
            $table->dropConstrainedForeignId('user_id');
        });
    }
};
