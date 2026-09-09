<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\Edition;
use App\Models\User;
use App\Models\Work;

/**
 * What the owner alone may do — publish, delete, invite editors, hand the
 * edition on — is what shapes who else gets to see or change it; a
 * site-wide editor may change the text of any edition but none of those.
 * Administrators pass every check before it is asked (see
 * AppServiceProvider).
 */
class EditionPolicy
{
    /**
     * Anyone can view a published edition; a draft only those who may edit
     * it — and the member it has been offered to, who should see what she
     * is asked to take on before she answers.
     */
    public function view(?User $user, Edition $edition): bool
    {
        if ($user !== null && $this->update($user, $edition)) {
            return true;
        }

        if ($user !== null && $edition->ownershipTransfers()->open()->where('to_user_id', $user->id)->exists()) {
            return true;
        }

        return $edition->isPublished();
    }

    /**
     * An edition is made on a work one may edit — one's own, or one whose
     * editions one has been invited to.
     */
    public function create(User $user, Work $work): bool
    {
        return $user->hasRole(Role::Editor) || $work->isEditableBy($user);
    }

    /**
     * The owner, her invited editors, and site-wide editors. Covers the
     * edition's text, selections, lineation, order, notes and citations.
     */
    public function update(User $user, Edition $edition): bool
    {
        return $user->hasRole(Role::Editor) || $edition->isEditableBy($user);
    }

    public function delete(User $user, Edition $edition): bool
    {
        return $edition->user_id === $user->id;
    }

    /**
     * Publishing an edition publishes every witness and conjecture connected
     * to its work, and unpublishing takes them back — the owner's call.
     */
    public function publish(User $user, Edition $edition): bool
    {
        return $edition->user_id === $user->id;
    }

    public function manageEditors(User $user, Edition $edition): bool
    {
        return $edition->user_id === $user->id;
    }

    public function transfer(User $user, Edition $edition): bool
    {
        return $edition->user_id === $user->id;
    }

    /**
     * Any member may copy a published edition; those who may edit one may
     * copy it before it is published.
     */
    public function copy(User $user, Edition $edition): bool
    {
        return $edition->isPublished() || $this->update($user, $edition);
    }
}
