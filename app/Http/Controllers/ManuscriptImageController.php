<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreManuscriptImageRequest;
use App\Models\Manuscript;
use App\Models\ManuscriptImage;
use Illuminate\Http\RedirectResponse;

class ManuscriptImageController extends Controller
{
    public function store(StoreManuscriptImageRequest $request, Manuscript $manuscript): RedirectResponse
    {
        $manuscript->images()->create([
            'folio_label' => $request->validated('folio_label'),
            'path' => $request->file('image')->store('manuscript-images', 'public'),
            'position' => ($manuscript->images()->max('position') ?? 0) + 1,
        ]);

        return back();
    }

    /**
     * Deleting an image cascades its features and any image-alignment
     * regions on it — the region's own transcription/segments are
     * untouched, regions are independent leaf annotations.
     */
    public function destroy(ManuscriptImage $image): RedirectResponse
    {
        $image->delete();

        return back();
    }
}
