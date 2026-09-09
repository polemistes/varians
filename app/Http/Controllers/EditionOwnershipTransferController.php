<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreEditionOwnershipTransferRequest;
use App\Models\Edition;
use App\Models\EditionOwnershipTransfer;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Handing an edition to another member. The owner (or an administrator)
 * offers; ownership moves only when the member named accepts — an
 * administrator cannot accept for her, since the point of acceptance is
 * that nobody is made responsible for an edition without agreeing to it.
 * See EditionOwnershipTransfer.
 */
class EditionOwnershipTransferController extends Controller
{
    public function store(StoreEditionOwnershipTransferRequest $request, Edition $edition): RedirectResponse
    {
        $user = User::where('email', $request->validated('email'))->firstOrFail();

        if ($user->id === $edition->user_id) {
            throw ValidationException::withMessages(['email' => 'That member already owns this edition.']);
        }

        if ($edition->ownershipTransfers()->open()->exists()) {
            throw ValidationException::withMessages(['email' => 'An offer is already open for this edition — withdraw it first.']);
        }

        $edition->ownershipTransfers()->create([
            'from_user_id' => $request->user()->id,
            'to_user_id' => $user->id,
        ]);

        return back();
    }

    /**
     * Withdraw an open offer — the owner's or an administrator's call, as
     * making it was.
     */
    public function destroy(EditionOwnershipTransfer $transfer): RedirectResponse
    {
        $this->authorize('transfer', $transfer->edition);

        if ($transfer->isOpen()) {
            $transfer->update(['outcome' => EditionOwnershipTransfer::WITHDRAWN, 'resolved_at' => now()]);
        }

        return back();
    }

    /**
     * The member named takes the edition. She leaves its editors if she was
     * among them — an owner is not her own guest.
     */
    public function accept(Request $request, EditionOwnershipTransfer $transfer): RedirectResponse
    {
        $this->guardRecipient($request, $transfer);

        DB::transaction(function () use ($transfer) {
            $transfer->edition->update(['user_id' => $transfer->to_user_id]);
            $transfer->edition->editors()->detach($transfer->to_user_id);
            $transfer->update(['outcome' => EditionOwnershipTransfer::ACCEPTED, 'resolved_at' => now()]);
        });

        return back();
    }

    public function decline(Request $request, EditionOwnershipTransfer $transfer): RedirectResponse
    {
        $this->guardRecipient($request, $transfer);

        $transfer->update(['outcome' => EditionOwnershipTransfer::DECLINED, 'resolved_at' => now()]);

        return back();
    }

    /**
     * Not a policy, deliberately: policies let an administrator through
     * before they are asked, and accepting on someone's behalf is exactly
     * what must not happen.
     */
    private function guardRecipient(Request $request, EditionOwnershipTransfer $transfer): void
    {
        abort_unless($transfer->isOpen() && $transfer->to_user_id === $request->user()->id, 403);
    }
}
