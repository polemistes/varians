<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\Conjecture;
use App\Models\Segment;
use App\Models\User;

class ConjecturePolicy
{
    public function view(?User $user, Conjecture $conjecture): bool
    {
        if ($user !== null && $this->update($user, $conjecture)) {
            return true;
        }

        return $conjecture->isPublished();
    }

    /**
     * A conjecture is recorded against a segment of a work one may edit.
     */
    public function create(User $user, Segment $segment): bool
    {
        return $user->hasRole(Role::Editor) || $segment->work->isEditableBy($user);
    }

    /**
     * The owner, whoever may edit the work, and site-wide editors.
     */
    public function update(User $user, Conjecture $conjecture): bool
    {
        return $user->hasRole(Role::Editor) || $conjecture->isEditableBy($user);
    }

    /**
     * Removing a conjecture from a work's stockpile is editing the work,
     * not destroying anyone's edition — so the same people as update.
     */
    public function delete(User $user, Conjecture $conjecture): bool
    {
        return $this->update($user, $conjecture);
    }
}
