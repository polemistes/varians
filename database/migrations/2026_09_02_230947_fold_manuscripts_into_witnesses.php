<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A witness IS its physical carrier: with the witness `type` gone, every
 * witness has the whole manuscript apparatus (repository, shelfmark, date,
 * pages, photographs) — all optional, so a collection of readings from the
 * Suda simply leaves the shelfmark empty. The separate `manuscripts` table
 * was a vestige of the type split; its fields fold into `witnesses` (`notes`
 * becomes the witness `description`), and pages and images hang off the
 * witness directly.
 *
 * Transcription tags go too, in the same cleanup: a transcription's NAME
 * says what it is; the tag vocabulary duplicated that.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Every structural step is guarded: SQLite cannot run this inside a
        // transaction, so a failure partway must be resumable by re-running.
        if (! Schema::hasColumn('witnesses', 'repository')) {
            Schema::table('witnesses', function (Blueprint $table) {
                $table->string('repository')->nullable();
                $table->string('shelfmark')->nullable();
                $table->string('date_text')->nullable();
                $table->text('description')->nullable();
            });
        }

        if (Schema::hasTable('manuscripts')) {
            foreach (DB::table('manuscripts')->get() as $manuscript) {
                DB::table('witnesses')->where('id', $manuscript->witness_id)->update([
                    'repository' => $manuscript->repository,
                    'shelfmark' => $manuscript->shelfmark,
                    'date_text' => $manuscript->date_text,
                    'description' => $manuscript->notes,
                ]);
            }

            Schema::table('manuscript_pages', function (Blueprint $table) {
                $table->foreignId('witness_id')->nullable()->after('id')
                    ->constrained()->cascadeOnDelete();
            });
            Schema::table('manuscript_images', function (Blueprint $table) {
                $table->foreignId('witness_id')->nullable()->after('id')
                    ->constrained()->cascadeOnDelete();
            });

            foreach (DB::table('manuscripts')->pluck('witness_id', 'id') as $manuscriptId => $witnessId) {
                DB::table('manuscript_pages')->where('manuscript_id', $manuscriptId)->update(['witness_id' => $witnessId]);
                DB::table('manuscript_images')->where('manuscript_id', $manuscriptId)->update(['witness_id' => $witnessId]);
            }

            Schema::table('manuscript_pages', function (Blueprint $table) {
                $table->dropConstrainedForeignId('manuscript_id');
            });
            Schema::table('manuscript_pages', function (Blueprint $table) {
                $table->foreignId('witness_id')->nullable(false)->change();
            });

            Schema::table('manuscript_images', function (Blueprint $table) {
                $table->dropConstrainedForeignId('manuscript_id');
            });
            Schema::table('manuscript_images', function (Blueprint $table) {
                $table->foreignId('witness_id')->nullable(false)->change();
            });

            Schema::drop('manuscripts');
        }

        Schema::dropIfExists('tag_transcription_layer');
        Schema::dropIfExists('tags');

        if (Schema::hasColumn('witnesses', 'type')) {
            Schema::table('witnesses', function (Blueprint $table) {
                $table->dropIndex('witnesses_type_index');
                $table->dropColumn('type');
            });
        }
    }

    public function down(): void
    {
        Schema::table('witnesses', function (Blueprint $table) {
            $table->string('type')->default('manuscript');
        });

        Schema::create('manuscripts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('witness_id')->constrained()->cascadeOnDelete();
            $table->string('repository')->nullable();
            $table->string('shelfmark')->nullable();
            $table->string('date_text')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
        });

        foreach (DB::table('witnesses')->get() as $witness) {
            DB::table('manuscripts')->insert([
                'witness_id' => $witness->id,
                'repository' => $witness->repository,
                'shelfmark' => $witness->shelfmark,
                'date_text' => $witness->date_text,
                'notes' => $witness->description,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        Schema::table('manuscript_pages', function (Blueprint $table) {
            $table->foreignId('manuscript_id')->nullable()->after('id')
                ->constrained()->cascadeOnDelete();
        });
        Schema::table('manuscript_images', function (Blueprint $table) {
            $table->foreignId('manuscript_id')->nullable()->after('id')
                ->constrained()->cascadeOnDelete();
        });

        foreach (DB::table('manuscripts')->pluck('id', 'witness_id') as $witnessId => $manuscriptId) {
            DB::table('manuscript_pages')->where('witness_id', $witnessId)->update(['manuscript_id' => $manuscriptId]);
            DB::table('manuscript_images')->where('witness_id', $witnessId)->update(['manuscript_id' => $manuscriptId]);
        }

        Schema::table('manuscript_pages', function (Blueprint $table) {
            $table->dropConstrainedForeignId('witness_id');
        });
        Schema::table('manuscript_pages', function (Blueprint $table) {
            $table->foreignId('manuscript_id')->nullable(false)->change();
        });

        Schema::table('manuscript_images', function (Blueprint $table) {
            $table->dropConstrainedForeignId('witness_id');
        });
        Schema::table('manuscript_images', function (Blueprint $table) {
            $table->foreignId('manuscript_id')->nullable(false)->change();
        });

        Schema::create('tags', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->timestamps();
        });

        Schema::create('tag_transcription_layer', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tag_id')->constrained()->cascadeOnDelete();
            $table->foreignId('transcription_layer_id')->constrained()->cascadeOnDelete();
        });

        Schema::table('witnesses', function (Blueprint $table) {
            $table->dropColumn(['repository', 'shelfmark', 'date_text', 'description']);
        });
    }
};
