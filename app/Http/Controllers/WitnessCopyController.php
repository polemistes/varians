<?php

namespace App\Http\Controllers;

use App\Models\Witness;
use App\Support\Copying\WitnessCopier;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * A member's own copy of a public witness: pages, photographs and
 * transcriptions, but not its citations — those belong to works she does
 * not own. See WitnessCopier.
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
