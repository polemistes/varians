<?php

namespace App\Policies;

use App\Enums\Role;
use App\Enums\Visibility;
use App\Models\User;
use App\Models\Witness;

class WitnessPolicy
{
    /**
     * An editor or administrator can view any witness. Otherwise a witness
     * is only visible once at least one of its transcriptions is published —
     * symmetric with WorkPolicy::view().
     */
    public function view(?User $user, Witness $witness): bool
    {
        if ($user !== null && $user->hasRole(Role::Editor)) {
            return true;
        }

        return $witness->transcriptions()->where('visibility', Visibility::Published)->exists();
    }
}
