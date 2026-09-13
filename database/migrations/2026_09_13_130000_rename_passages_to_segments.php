<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The smallest range of a work its numbering scheme can address is a
 * SEGMENT (user decision: "passage is vague — it may mean any type of
 * textual passage; segment is much clearer, referring to the work's
 * canonical numbering scheme"). The models are App\Models\Segment and
 * App\Models\EditionSegment; this brings the tables and every column that
 * points at a segment with them.
 *
 * Every index over a renamed column is renamed too, so that a later
 * migration dropping one by its column list — which computes the name from
 * the CURRENT table and column names — finds it. SQLite (≥ 3.26) rewrites
 * the REFERENCES clauses of the pointing tables as part of a table rename,
 * and a column's own FOREIGN KEY clause as part of a column rename.
 */
return new class extends Migration
{
    /** @var array<string, list<array{0: string, 1: string}>> table → [old index, new index] */
    private array $indexes = [
        'segments' => [
            ['canonical_passages_work_id_sort_key_unique', 'segments_work_id_sort_key_unique'],
        ],
        'edition_segments' => [
            ['edition_passages_edition_id_canonical_passage_id_part_unique', 'edition_segments_edition_id_segment_id_part_unique'],
            ['edition_passages_edition_id_position_index', 'edition_segments_edition_id_position_index'],
        ],
        'conjecture_ordering_entries' => [
            ['conjecture_ordering_entries_conjecture_id_canonical_passage_id_part_unique', 'conjecture_ordering_entries_conjecture_id_segment_id_part_unique'],
        ],
        'edition_line_breaks' => [
            ['edition_line_breaks_edition_id_canonical_passage_id_index', 'edition_line_breaks_edition_id_segment_id_index'],
        ],
        'edition_comments' => [
            ['edition_comments_edition_id_canonical_passage_id_index', 'edition_comments_edition_id_segment_id_index'],
        ],
        'bibliography_references' => [
            ['bibliography_references_edition_id_canonical_passage_id_index', 'bibliography_references_edition_id_segment_id_index'],
        ],
    ];

    /** @var array<string, list<array{0: string, 1: string}>> table → [old column, new column] */
    private array $columns = [
        'assignments' => [['canonical_passage_id', 'segment_id']],
        'edition_segments' => [['canonical_passage_id', 'segment_id']],
        'conjectures' => [
            ['canonical_passage_id', 'segment_id'],
            ['transposition_range_end_canonical_passage_id', 'transposition_range_end_segment_id'],
            ['move_target_canonical_passage_id', 'move_target_segment_id'],
        ],
        'conjecture_ordering_entries' => [['canonical_passage_id', 'segment_id']],
        'lemmas' => [['canonical_passage_id', 'segment_id']],
        'edition_line_breaks' => [['canonical_passage_id', 'segment_id']],
        'edition_comments' => [['canonical_passage_id', 'segment_id']],
        'bibliography_references' => [['canonical_passage_id', 'segment_id']],
    ];

    public function up(): void
    {
        Schema::rename('canonical_passages', 'segments');
        Schema::rename('edition_passages', 'edition_segments');

        foreach ($this->columns as $table => $columns) {
            Schema::table($table, function (Blueprint $blueprint) use ($columns) {
                foreach ($columns as [$from, $to]) {
                    $blueprint->renameColumn($from, $to);
                }
            });
        }

        foreach ($this->indexes as $table => $indexes) {
            Schema::table($table, function (Blueprint $blueprint) use ($indexes) {
                foreach ($indexes as [$from, $to]) {
                    $blueprint->renameIndex($from, $to);
                }
            });
        }
    }

    public function down(): void
    {
        foreach ($this->indexes as $table => $indexes) {
            Schema::table($table, function (Blueprint $blueprint) use ($indexes) {
                foreach ($indexes as [$from, $to]) {
                    $blueprint->renameIndex($to, $from);
                }
            });
        }

        foreach ($this->columns as $table => $columns) {
            Schema::table($table, function (Blueprint $blueprint) use ($columns) {
                foreach ($columns as [$from, $to]) {
                    $blueprint->renameColumn($to, $from);
                }
            });
        }

        Schema::rename('edition_segments', 'edition_passages');
        Schema::rename('segments', 'canonical_passages');
    }
};
