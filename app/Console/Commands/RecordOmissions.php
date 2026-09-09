<?php

namespace App\Console\Commands;

use App\Models\CanonicalPassage;
use App\Models\Lemma;
use App\Support\Edition\PassageAligner;
use Illuminate\Console\Command;

/**
 * Bring every collated passage's omission readings up to date (see
 * PassageAligner::recordOmissions) — for passages collated before
 * omissions were recorded at all, or after anything that changed columns
 * without going through the aligner.
 */
class RecordOmissions extends Command
{
    protected $signature = 'collation:record-omissions';

    protected $description = 'Record, for every collated passage, where each witness lacks words the others have';

    public function handle(): int
    {
        $passageIds = Lemma::query()->distinct()->pluck('canonical_passage_id');
        $count = 0;

        foreach (CanonicalPassage::whereIn('id', $passageIds)->cursor() as $passage) {
            PassageAligner::recordOmissions($passage);
            $count++;
        }

        $this->info("Omissions recorded on {$count} passages.");

        return self::SUCCESS;
    }
}
