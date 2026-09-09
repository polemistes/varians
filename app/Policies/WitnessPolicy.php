<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\User;
use App\Models\Witness;

class WitnessPolicy
{
    /**
     * Everyone can view a witness with a published transcription; one with
     * none only those who may edit it.
     */
    public function view(?User $user, Witness $witness): bool
    {
        if ($user !== null && $this->update($user, $witness)) {
            return true;
        }

        return $witness->isPublished();
    }

    /**
     * Every member registers witnesses of her own.
     */
    public function create(User $user): bool
    {
        return true;
    }

    /**
     * The owner, whoever may edit a work the witness is connected to, and
     * site-wide editors. Covers everything inside the witness: pages,
     * photographs, transcriptions and their text, citations and mappings.
     */
    public function update(User $user, Witness $witness): bool
    {
        return $user->hasRole(Role::Editor) || $witness->isEditableBy($user);
    }

    /**
     * Only the owner — and not while someone else's edition prints text
     * from it, since deleting cascades that edition's passages and chosen
     * readings away with the transcriptions. A site-wide editor edits,
     * never destroys; an administrator may still.
     */
    public function delete(User $user, Witness $witness): bool
    {
        return $witness->user_id === $user->id
            && ! $witness->isPrintedByAnothersEdition($user);
    }

    /**
     * Publishing a transcription of the witness by hand — as opposed to an
     * edition's publication carrying it along — is the owner's call, as
     * publishing an edition is its owner's.
     */
    public function publish(User $user, Witness $witness): bool
    {
        return $witness->user_id === $user->id;
    }

    /**
     * Any member may copy a public witness; those who may edit one may copy
     * it before it is.
     */
    public function copy(User $user, Witness $witness): bool
    {
        return $witness->isPublished() || $this->update($user, $witness);
    }
}
