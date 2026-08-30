<?php

namespace App\Http\Controllers;

use App\Models\Witness;
use App\Models\Work;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class HomeController extends Controller
{
    public function index(Request $request): Response
    {
        return Inertia::render('Home', [
            'workCount' => Work::visibleTo($request->user())->count(),
            'witnessCount' => Witness::visibleTo($request->user())->count(),
        ]);
    }
}
