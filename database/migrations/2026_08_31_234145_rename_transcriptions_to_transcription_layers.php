<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A `transcriptions` row has always been one *layer* of a transcription — it
 * carries `layer` and `text` directly, and every table referencing it means
 * "this layer's text and offsets". The name is what was wrong, not the
 * relationships, so this migration only renames: the parent that groups a
 * witness's diplomatic and normalized layers arrives in the next one.
 */
return new class extends Migration
{
    /**
     * The tables whose `transcription_id` points at what is really a layer.
     *
     * @var array<int, string>
     */
    private const REFERENCING_TABLES = [
        'transcription_segments',
        'transcription_regions',
        'lemma_readings',
        'tag_transcription',
        'edition_passages',
        'edition_passage_orders',
    ];

    public function up(): void
    {
        Schema::rename('transcriptions', 'transcription_layers');

        foreach (self::REFERENCING_TABLES as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->renameColumn('transcription_id', 'transcription_layer_id');
            });
        }

        // Tags describe a layer, so the pivot follows the convention its
        // models now imply.
        Schema::rename('tag_transcription', 'tag_transcription_layer');
    }

    public function down(): void
    {
        Schema::rename('tag_transcription_layer', 'tag_transcription');

        foreach (self::REFERENCING_TABLES as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->renameColumn('transcription_layer_id', 'transcription_id');
            });
        }

        Schema::rename('transcription_layers', 'transcriptions');
    }
};
