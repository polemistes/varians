<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreEditionAdoptionRequest;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Support\Edition\ArrangementAdopter;
use Illuminate\Http\RedirectResponse;

class EditionAdoptionController extends Controller
{
    /**
     * Adopt a catalogued ordering proposal for this edition: its sequence
     * becomes the printed order, and a line it divides is printed in
     * pieces (see ArrangementAdopter). Reached from the line notice, where
     * a registered proposal is reported beside the witnesses' variants.
     */
    public function store(StoreEditionAdoptionRequest $request, Edition $edition): RedirectResponse
    {
        ArrangementAdopter::adopt($edition, Conjecture::findOrFail((int) $request->validated('conjecture_id')));

        return back();
    }
}
