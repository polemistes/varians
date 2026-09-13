<?php

namespace App\Support\Copying;

use App\Models\Segment;
use App\Models\User;
use App\Models\Work;

/**
 * A work of one's own: the work itself under a free slug, and its segments,
 * which everything else is addressed by. Nothing that hangs off the work
 * comes along — editions, conjectures and witnesses are copied by their own
 * copiers, each of which decides what its copy needs.
 *
 * Two callers, for two reasons. EditionCopier copies the work because
 * lemma columns are shared by every edition OF A WORK, so an edition that
 * shared the work would re-collate the original when edited. WitnessCopier
 * copies it when a member takes someone else's witness, so that her
 * assignments are her own and her edits show up in her editions rather
 * than in the original editor's.
 */
class WorkCopier
{
    /**
     * @return array{work: Work, segments: array<int, int>} the copy, and old segment id → new
     */
    public static function copy(Work $work, User $owner): array
    {
        $copy = $work->replicate(['user_id', 'copied_from_id', 'slug']);
        $copy->user_id = $owner->id;
        $copy->copied_from_id = $work->id;
        $copy->slug = self::freshSlug($work->slug);
        $copy->save();

        $segments = [];

        foreach ($work->segments()->orderBy('sort_key')->get() as $segment) {
            /** @var Segment $segment */
            $segmentCopy = $segment->replicate();
            $segmentCopy->work_id = $copy->id;
            $segmentCopy->save();
            $segments[$segment->id] = $segmentCopy->id;
        }

        return ['work' => $copy, 'segments' => $segments];
    }

    /**
     * The original's slug with `-copy` on it, numbered from 2 if that is
     * taken — the slug is unique and a work is copied more than once.
     */
    private static function freshSlug(string $slug): string
    {
        $base = $slug.'-copy';
        $candidate = $base;

        for ($n = 2; Work::query()->where('slug', $candidate)->exists(); $n++) {
            $candidate = $base.'-'.$n;
        }

        return $candidate;
    }
}
