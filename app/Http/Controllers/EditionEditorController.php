<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreEditionEditorRequest;
use App\Models\Edition;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Validation\ValidationException;

/**
 * The members an owner invites to edit her edition — and, through its
 * work, the witnesses and conjectures it draws on. Only the owner (or an
 * administrator) grants and revokes; see EditionPolicy::manageEditors.
 */
class EditionEditorController extends Controller
{
    public function store(StoreEditionEditorRequest $request, Edition $edition): RedirectResponse
    {
        $user = User::where('email', $request->validated('email'))->firstOrFail();

        if ($user->id === $edition->user_id) {
            throw ValidationException::withMessages(['email' => 'That is the owner.']);
        }

        $edition->editors()->syncWithoutDetaching([
            $user->id => ['granted_by_id' => $request->user()->id],
        ]);

        return back();
    }

    public function destroy(Edition $edition, User $user): RedirectResponse
    {
        $this->authorize('manageEditors', $edition);

        $edition->editors()->detach($user->id);

        return back();
    }
}
