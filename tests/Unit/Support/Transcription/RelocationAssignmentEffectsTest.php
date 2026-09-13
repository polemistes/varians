<?php

use App\Models\Assignment;
use App\Support\Transcription\RelocationAssignmentEffects;
use Illuminate\Database\Eloquent\Collection;

/**
 * The plan replays the op prefix before a cut exactly as the real transform
 * will — text included, so an assignment that carried on across a gap
 * (SpanTransformer::claimant's `enclosing` rule) is seen with the words it
 * took. Without the text the plan worked from stale bounds and a cut of
 * those very words made no fragment.
 */
function assignmentRows(array $bounds): Collection
{
    return new Collection(array_map(fn (array $span, int $index) => new Assignment([
        'segment_id' => $index + 1,
        'start_offset' => $span[0],
        'end_offset' => $span[1],
        'needs_review' => false,
    ]), $bounds, array_keys($bounds)));
}

test('a cut of words the assignment before had reached over yields a fragment of that assignment', function () {
    // "the  fox": "the" and "fox" assigned, two spaces between. Typing "x"
    // in the gap makes "the" carry on over it ("the x"); cutting " x" out
    // of that and pasting it at the end is a partial cut of "the".
    $ops = [
        ['start' => 4, 'end' => 4, 'text' => 'x'],
        ['start' => 3, 'end' => 5, 'text' => '', 'cut_id' => 'c1'],
        ['start' => 7, 'end' => 7, 'text' => ' x', 'cut_id' => 'c1'],
    ];

    $withText = RelocationAssignmentEffects::plan(assignmentRows([[0, 3], [5, 8]]), $ops, 'the  fox');
    $withoutText = RelocationAssignmentEffects::plan(assignmentRows([[0, 3], [5, 8]]), $ops);

    expect($withText['creates'])->toHaveCount(1)
        ->and($withText['creates'][0])->toMatchArray(['segment_id' => 1, 'start' => 7, 'end' => 9, 'anchor_index' => 0, 'placement' => 'after'])
        ->and($withoutText['creates'])->toBe([]);
});
