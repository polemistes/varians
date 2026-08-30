<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * A segment stops owning its own text and manual position — it becomes a
     * pure citation-span annotation (start_offset/end_offset) over the parent
     * transcription's own continuous `text`. Physical reading order is now
     * simply the span's position in that string, so a manually-set `position`
     * is no longer needed. `starts_new_paragraph` is dropped too: paragraphing
     * is now just whatever whitespace the scholar typed into the continuous
     * text, not a fact attached to one citation span.
     */
    public function up(): void
    {
        Schema::table('transcription_segments', function (Blueprint $table) {
            $table->dropIndex(['position']);
            $table->dropColumn(['position', 'text', 'starts_new_paragraph']);
            $table->unsignedInteger('start_offset')->after('canonical_passage_id');
            $table->unsignedInteger('end_offset')->after('start_offset');
            $table->boolean('needs_review')->default(false)->after('end_offset');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('transcription_segments', function (Blueprint $table) {
            $table->dropColumn(['start_offset', 'end_offset', 'needs_review']);
            $table->decimal('position', 20, 10)->index();
            $table->longText('text');
            $table->boolean('starts_new_paragraph')->default(false);
        });
    }
};
