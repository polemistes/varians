<?php

namespace App\Http\Controllers;

use App\Models\LemmaReading;
use Illuminate\Http\RedirectResponse;

class LemmaReadingController extends Controller
{
    public function destroy(LemmaReading $reading): RedirectResponse
    {
        $reading->delete();

        return back();
    }
}
