<?php

namespace App\Policies;

use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;

/**
 * A transcription is part of its witness: whoever may see or edit the
 * witness may see or edit its transcriptions, and a transcription is
 * public once published.
 */
class TranscriptionLayerPolicy
{
    public function view(?User $user, TranscriptionLayer $transcription): bool
    {
        if ($transcription->transcription->isPublished()) {
            return true;
        }

        return $user !== null && $this->update($user, $transcription);
    }

    public function update(User $user, TranscriptionLayer $transcription): bool
    {
        /** @var Witness $witness */
        $witness = $transcription->witness;

        return $user->can('update', $witness);
    }
}
