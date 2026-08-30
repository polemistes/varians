<?php

namespace App\Policies;

use App\Enums\Role;
use App\Enums\Visibility;
use App\Models\Edition;
use App\Models\User;

class EditionPolicy
{
    /**
     * Anyone can view a published edition; a draft is only visible to an
     * editor or administrator — any editor, not just the one who created it,
     * since editing here is fully collaborative.
     */
    public function view(?User $user, Edition $edition): bool
    {
        if ($edition->visibility === Visibility::Published) {
            return true;
        }

        return $user !== null && $user->hasRole(Role::Editor);
    }
}
