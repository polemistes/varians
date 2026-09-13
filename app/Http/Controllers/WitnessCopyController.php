<?php

namespace App\Http\Controllers;

use App\Models\Witness;
use App\Models\Work;
use App\Support\Copying\WitnessCopier;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * A member's own copy of a witness: pages, photographs, transcriptions and
 * the assignments over them. Copying someone else's witness copies the
 * works it assigns text to as well, so the assignments are her own — and
 * since that puts works in her list she never asked for by name, it is
 * reported rather than left to be discovered. See WitnessCopier.
 */
class WitnessCopyController extends Controller
{
    public function store(Request $request, Witness $witness): RedirectResponse
    {
        $this->authorize('copy', $witness);

        $copied = WitnessCopier::copy($witness, $request->user());
        $works = collect($copied['works'])->map(fn (Work $work) => $work->title)->sort()->values();
        $redirect = redirect()->route('witnesses.show', $copied['witness']);

        if ($works->isEmpty()) {
            return $redirect;
        }

        return $redirect->with('message', $works->count() === 1
            ? "Your copy assigns its text to your own copy of {$works->first()}, not to the original."
            : 'Your copy assigns its text to your own copies of '.$works->join(', ', ' and ').', not to the originals.');
    }
}
