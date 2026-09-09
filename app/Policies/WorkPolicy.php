<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\User;
use App\Models\Work;

/**
 * A work is the hub: editing it — and, through it, every witness and
 * conjecture connected to it — is open to its owner, to the owner or an
 * invited editor of any of its editions, and to site-wide editors.
 * Administrators pass every check before it is asked (see
 * AppServiceProvider).
 */
class WorkPolicy
{
    /**
     * Everyone can view a published work; a draft only those who may edit it.
     */
    public function view(?User $user, Work $work): bool
    {
        if ($user !== null && $this->update($user, $work)) {
            return true;
        }

        return $work->isPublished();
    }

    /**
     * Every member registers works of her own.
     */
    public function create(User $user): bool
    {
        return true;
    }

    public function update(User $user, Work $work): bool
    {
        return $user->hasRole(Role::Editor) || $work->isEditableBy($user);
    }

    /**
     * Only the owner: deleting takes every edition, conjecture and citation
     * of the work with it. A site-wide editor edits, never destroys — and
     * neither does the owner while an edition of the work belongs to
     * someone else (handed on, or made by an invitee), since that would
     * destroy what is no longer hers. An administrator may still.
     */
    public function delete(User $user, Work $work): bool
    {
        return $work->user_id === $user->id
            && ! $work->editions()->where('user_id', '!=', $user->id)->exists();
    }
}
