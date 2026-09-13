<?php

namespace App\Console\Commands;

use App\Models\TranscriptionLayer;
use App\Support\Transcription\AssignmentIntegrity;
use Illuminate\Console\Command;

/**
 * Lists every transcript layer whose assignment spans have drifted off
 * their words — see AssignmentIntegrity. Reports only; the editor mends
 * the assignments in the transcript editor.
 */
class CheckAssignmentIntegrity extends Command
{
    protected $signature = 'transcriptions:check-assignments {--snap : Flag spans that slipped off their words, and clear flags that no longer apply}';

    protected $description = 'List transcript layers whose assignment spans no longer sit on whole words';

    public function handle(): int
    {
        if ($this->option('snap')) {
            foreach (TranscriptionLayer::with('transcription.witness')->get() as $layer) {
                foreach (AssignmentIntegrity::snap($layer) as $change) {
                    $this->line(sprintf('Layer #%d (%s, %s): %s', $layer->id, $layer->transcription->witness->siglum, $layer->layer->value, $change));
                }
            }
        }

        $report = AssignmentIntegrity::report();

        if ($report->isEmpty()) {
            $this->info('Every assignment span sits on whole words.');

            return self::SUCCESS;
        }

        foreach ($report as $finding) {
            $layer = $finding['layer'];
            $this->warn(sprintf('Layer #%d — %s, %s (%s):', $layer->id, $layer->transcription->witness->siglum, $layer->layer->value, $layer->transcription->name));

            foreach ($finding['issues'] as $issue) {
                $this->line('  '.$issue);
            }
        }

        return self::FAILURE;
    }
}
