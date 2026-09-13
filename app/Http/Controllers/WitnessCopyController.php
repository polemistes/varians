<?php

namespace App\Http\Controllers;

use App\Models\Witness;
use App\Support\Copying\WitnessCopier;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * A member's own copy of a public witness: pages, photographs,
 * transcriptions and the citations over them, which go on naming the
 * passages they named before — the assignments follow any copy (user
 * decision). See WitnessCopier.
 */
class WitnessCopyController extends Controller
{
    public function store(Request $request, Witness $witness): RedirectResponse
    {
        $this->authorize('copy', $witness);

        $copy = WitnessCopier::copy($witness, $request->user())['witness'];

        return redirect()->route('witnesses.show', $copy);
    }
}
