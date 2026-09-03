<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreManuscriptPageRequest;
use App\Http\Requests\UpdateManuscriptPageRequest;
use App\Models\ManuscriptPage;
use App\Models\Witness;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;

class ManuscriptPageController extends Controller
{
    /**
     * Add a page to a manuscript. Pages can be laid out in full before any
     * transcribing begins — and before any image exists — so that an imported
     * text can be divided onto them.
     */
    public function store(StoreManuscriptPageRequest $request, Witness $witness): RedirectResponse
    {
        $witness->pages()->create([
            'label' => $request->validated('label'),
            'position' => ($witness->pages()->max('position') ?? 0) + 1,
        ]);

        return back();
    }

    /**
     * Move a page one step up or down in the witness's page order, by
     * swapping positions with its neighbour. A swap rather than midpoint
     * arithmetic: repeated reordering must never erode the decimal
     * precision the positions live in. At either end this is a no-op.
     */
    public function update(UpdateManuscriptPageRequest $request, ManuscriptPage $page): RedirectResponse
    {
        $up = $request->validated('direction') === 'up';

        $neighbour = ManuscriptPage::query()
            ->where('witness_id', $page->witness_id)
            ->when(
                $up,
                fn ($query) => $query->where('position', '<', $page->position)->orderByDesc('position'),
                fn ($query) => $query->where('position', '>', $page->position)->orderBy('position'),
            )
            ->first();

        if ($neighbour !== null) {
            DB::transaction(function () use ($page, $neighbour) {
                $position = $page->position;
                $page->update(['position' => $neighbour->position]);
                $neighbour->update(['position' => $position]);
            });
        }

        return back();
    }

    /**
     * Deleting a page cascades its images (with their features and any
     * image-alignment regions on them) and every layer's break for it — the
     * text itself is untouched, it simply stops being divided there.
     */
    public function destroy(ManuscriptPage $page): RedirectResponse
    {
        $page->delete();

        return back();
    }
}
