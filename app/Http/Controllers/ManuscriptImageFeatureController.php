<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreManuscriptImageFeatureRequest;
use App\Models\ManuscriptImage;
use App\Models\ManuscriptImageFeature;
use Illuminate\Http\RedirectResponse;

class ManuscriptImageFeatureController extends Controller
{
    public function store(StoreManuscriptImageFeatureRequest $request, ManuscriptImage $image): RedirectResponse
    {
        $image->features()->create($request->validated());

        return back();
    }

    public function destroy(ManuscriptImageFeature $feature): RedirectResponse
    {
        $feature->delete();

        return back();
    }
}
