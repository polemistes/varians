<?php

namespace App\Policies;

use App\Enums\Role;
use App\Enums\Visibility;
use App\Models\User;
use App\Models\Work;

class WorkPolicy
{
    /**
     * An editor or administrator can view any work. Otherwise a work is only
     * visible once at least one published transcription cites one of its
     * canonical passages — an unpublished work-in-progress shouldn't appear
     * to guests before there's anything to actually read.
     */
    public function view(?User $user, Work $work): bool
    {
        if ($user !== null && $user->hasRole(Role::Editor)) {
            return true;
        }

        return $work->canonicalPassages()
            ->whereHas('transcriptionSegments.transcription', fn ($query) => $query->where('visibility', Visibility::Published))
            ->exists();
    }
}
