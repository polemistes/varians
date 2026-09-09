<?php

namespace App\Support\Transcription;

use App\Models\Transcription;
use App\Models\Work;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * One transcript per witness per work (user decision): once a witness's
 * text of a work is cited in one of its transcripts, every citation of
 * that work in that witness belongs to the same transcript. A witness may
 * still hold several transcripts — for different works, or one transcript
 * for all its works — and a work a witness carries in two separate places
 * still fits one transcript, with page breaks saying where each stretch
 * sits. The edition page's witness pulldown can then name a witness and
 * mean one transcript.
 *
 * Enforced where citations are made (marking a span, re-citing it,
 * copying spans across transcripts); `violations()` reports what older
 * data breaks the rule, for the `witnesses:check-work-ownership` command —
 * nothing is changed silently.
 */
class WorkOwnership
{
    /**
     * The other transcript of the same witness that already holds the work,
     * if any.
     */
    public static function holder(Transcription $transcription, Work $work): ?Transcription
    {
        return Transcription::query()
            ->where('witness_id', $transcription->witness_id)
            ->whereKeyNot($transcription->id)
            ->whereHas('layers.segments.canonicalPassage', fn ($query) => $query->where('work_id', $work->id))
            ->with('witness:id,siglum')
            ->first();
    }

    /**
     * Refuse a citation of the work in this transcript when another
     * transcript of the witness holds it.
     */
    public static function guard(Transcription $transcription, Work $work, string $field = 'work_id'): void
    {
        $holder = self::holder($transcription, $work);

        if ($holder === null) {
            return;
        }

        throw ValidationException::withMessages([
            $field => sprintf(
                '%s already holds %s in the transcript “%s”. All of a work\'s text in a witness belongs to one transcript — cite it there.',
                $holder->witness->siglum,
                $work->title,
                $holder->name,
            ),
        ]);
    }

    /**
     * Every (witness, work) held by more than one transcript.
     *
     * @return Collection<int, array{witness_id: int, siglum: string, work_id: int, title: string, transcriptions: list<array{id: int, name: string, citations: int}>}>
     */
    public static function violations(): Collection
    {
        $rows = DB::table('transcription_segments')
            ->join('transcription_layers', 'transcription_layers.id', '=', 'transcription_segments.transcription_layer_id')
            ->join('transcriptions', 'transcriptions.id', '=', 'transcription_layers.transcription_id')
            ->join('witnesses', 'witnesses.id', '=', 'transcriptions.witness_id')
            ->join('canonical_passages', 'canonical_passages.id', '=', 'transcription_segments.canonical_passage_id')
            ->join('works', 'works.id', '=', 'canonical_passages.work_id')
            ->selectRaw('witnesses.id as witness_id, witnesses.siglum, works.id as work_id, works.title, transcriptions.id as transcription_id, transcriptions.name, count(*) as citations')
            ->groupBy('witnesses.id', 'witnesses.siglum', 'works.id', 'works.title', 'transcriptions.id', 'transcriptions.name')
            ->orderBy('witnesses.siglum')
            ->orderBy('works.title')
            ->orderBy('transcriptions.id')
            ->get();

        $violations = [];

        foreach ($rows->groupBy(fn (object $row) => $row->witness_id.':'.$row->work_id) as $group) {
            if ($group->count() < 2) {
                continue;
            }

            /** @var object{witness_id: int|string, siglum: string, work_id: int|string, title: string} $first */
            $first = $group->first();
            $transcriptions = [];

            foreach ($group as $row) {
                /** @var object{transcription_id: int|string, name: string, citations: int|string} $row */
                $transcriptions[] = [
                    'id' => (int) $row->transcription_id,
                    'name' => (string) $row->name,
                    'citations' => (int) $row->citations,
                ];
            }

            $violations[] = [
                'witness_id' => (int) $first->witness_id,
                'siglum' => (string) $first->siglum,
                'work_id' => (int) $first->work_id,
                'title' => (string) $first->title,
                'transcriptions' => $transcriptions,
            ];
        }

        return collect($violations);
    }
}
