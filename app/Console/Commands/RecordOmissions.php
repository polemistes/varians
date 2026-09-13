<?php

namespace App\Console\Commands;

use App\Models\Lemma;
use App\Models\Segment;
use App\Support\Edition\SegmentAligner;
use Illuminate\Console\Command;

/**
 * Bring every collated segment's omission readings up to date (see
 * SegmentAligner::recordOmissions) — for segments collated before
 * omissions were recorded at all, or after anything that changed columns
 * without going through the aligner.
 */
class RecordOmissions extends Command
{
    protected $signature = 'collation:record-omissions';

    protected $description = 'Record, for every collated segment, where each witness lacks words the others have';

    public function handle(): int
    {
        $segmentIds = Lemma::query()->distinct()->pluck('segment_id');
        $count = 0;

        foreach (Segment::whereIn('id', $segmentIds)->cursor() as $segment) {
            SegmentAligner::recordOmissions($segment);
            $count++;
        }

        $this->info("Omissions recorded on {$count} segments.");

        return self::SUCCESS;
    }
}
