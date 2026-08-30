<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateProfileRequest;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

class ProfileController extends Controller
{
    public function edit(): Response
    {
        return Inertia::render('Profile/Edit');
    }

    /**
     * Always operates on the current user — there is no route parameter, so
     * a user can never target anyone else's profile.
     */
    public function update(UpdateProfileRequest $request): RedirectResponse
    {
        $request->user()->update($request->safe()->only(['name', 'email']));

        if ($request->filled('password')) {
            $request->user()->update(['password' => $request->validated('password')]);
        }

        return back();
    }
}
