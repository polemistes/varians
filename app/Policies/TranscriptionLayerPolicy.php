<?php

namespace App\Policies;

use App\Enums\Role;
use App\Enums\Visibility;
use App\Models\TranscriptionLayer;
use App\Models\User;

class TranscriptionLayerPolicy
{
    /**
     * Anyone can view a published transcription; a draft is only visible to
     * an editor or administrator — any editor, not just the one who wrote
     * it, since editing here is fully collaborative.
     */
    public function view(?User $user, TranscriptionLayer $transcription): bool
    {
        if ($transcription->transcription->visibility === Visibility::Published) {
            return true;
        }

        return $user !== null && $user->hasRole(Role::Editor);
    }
}
