<?php

namespace App\Console\Commands;

use App\Support\Transcription\WorkOwnership;
use Illuminate\Console\Command;

/**
 * Reports every witness holding one work in more than one transcript —
 * data from before the one-transcript-per-witness-per-work rule (see
 * WorkOwnership). It changes nothing: which transcript should keep the
 * work is the editor's call, made in the transcript editor.
 */
class CheckWorkOwnership extends Command
{
    protected $signature = 'witnesses:check-work-ownership';

    protected $description = 'List witnesses holding one work in more than one transcript';

    public function handle(): int
    {
        $violations = WorkOwnership::violations();

        if ($violations->isEmpty()) {
            $this->info('Every work a witness holds is cited in one transcript of it.');

            return self::SUCCESS;
        }

        foreach ($violations as $violation) {
            $this->warn(sprintf('%s holds %s in %d transcripts:', $violation['siglum'], $violation['title'], count($violation['transcriptions'])));

            foreach ($violation['transcriptions'] as $transcription) {
                $this->line(sprintf('  #%d %s — %d citation(s)', $transcription['id'], $transcription['name'], $transcription['citations']));
            }
        }

        $this->line('Move the citations into one transcript per witness in the transcript editor; nothing was changed.');

        return self::FAILURE;
    }
}
