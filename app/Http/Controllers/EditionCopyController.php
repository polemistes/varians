<?php

namespace App\Http\Controllers;

use App\Models\Edition;
use App\Support\Copying\EditionCopier;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * A member's own copy of a public edition — see EditionCopier for what
 * comes with it.
 */
class EditionCopyController extends Controller
{
    public function store(Request $request, Edition $edition): RedirectResponse
    {
        $this->authorize('copy', $edition);

        $copy = EditionCopier::copy($edition, $request->user());

        return redirect()->route('editions.show', [$copy->work, $copy]);
    }
}
