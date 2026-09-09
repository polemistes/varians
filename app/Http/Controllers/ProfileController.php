<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateProfileRequest;
use App\Models\EditionOwnershipTransfer;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ProfileController extends Controller
{
    /**
     * Her own details, and the editions other members have offered her —
     * this is where an offer is accepted or declined.
     */
    public function edit(Request $request): Response
    {
        return Inertia::render('Profile/Edit', [
            'offers' => $request->user()->ownershipOffers()->open()
                ->with(['edition:id,work_id,title', 'edition.work:id,title,slug', 'fromUser:id,name'])
                ->orderBy('created_at')
                ->get()
                ->map(fn (EditionOwnershipTransfer $offer) => [
                    'id' => $offer->id,
                    'edition' => ['id' => $offer->edition->id, 'title' => $offer->edition->title],
                    'work' => ['title' => $offer->edition->work->title, 'slug' => $offer->edition->work->slug],
                    'from' => $offer->fromUser->only(['id', 'name']),
                ])
                ->values(),
        ]);
    }

    /**
     * Always operates on the current user — there is no route parameter, so
     * a user can never target anyone else's profile.
     */
    public function update(UpdateProfileRequest $request): RedirectResponse
    {
        $request->user()->update($request->safe()->only(['name', 'email', 'greek_font']));

        if ($request->filled('password')) {
            $request->user()->update(['password' => $request->validated('password')]);
        }

        return back();
    }
}
