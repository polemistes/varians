<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreManuscriptPageRequest;
use App\Models\Manuscript;
use App\Models\ManuscriptPage;
use Illuminate\Http\RedirectResponse;

class ManuscriptPageController extends Controller
{
    /**
     * Add a page to a manuscript. Pages can be laid out in full before any
     * transcribing begins — and before any image exists — so that an imported
     * text can be divided onto them.
     */
    public function store(StoreManuscriptPageRequest $request, Manuscript $manuscript): RedirectResponse
    {
        $manuscript->pages()->create([
            'label' => $request->validated('label'),
            'position' => ($manuscript->pages()->max('position') ?? 0) + 1,
        ]);

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
