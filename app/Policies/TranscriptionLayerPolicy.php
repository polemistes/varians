<?php

namespace App\Policies;

use App\Enums\Role;
use App\Enums\Visibility;
use App\Models\Transcription;
use App\Models\User;

class TranscriptionPolicy
{
    /**
     * Anyone can view a published transcription; a draft is only visible to
     * an editor or administrator — any editor, not just the one who wrote
     * it, since editing here is fully collaborative.
     */
    public function view(?User $user, Transcription $transcription): bool
    {
        if ($transcription->visibility === Visibility::Published) {
            return true;
        }

        return $user !== null && $user->hasRole(Role::Editor);
    }
}
