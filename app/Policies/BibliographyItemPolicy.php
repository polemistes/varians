<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\BibliographyItem;
use App\Models\BibliographyReference;
use App\Models\User;

/**
 * The bibliography is common: every member adds to it, and everyone reads
 * it. Changing an entry is another matter, since a change reaches every
 * apparatus that cites it — so a member may only alter or remove an item
 * nobody else relies on: one she added that nothing cites, or one cited
 * only by her own editions and conjectures. Site-wide editors may alter
 * any item.
 */
class BibliographyItemPolicy
{
    public function create(User $user): bool
    {
        return true;
    }

    public function update(User $user, BibliographyItem $item): bool
    {
        return $user->hasRole(Role::Editor) || $this->isOnlyHers($user, $item);
    }

    public function delete(User $user, BibliographyItem $item): bool
    {
        return $user->hasRole(Role::Editor) || $this->isOnlyHers($user, $item);
    }

    /**
     * Nobody else uses the item: every citation of it is by an edition she
     * owns or a conjecture she owns — and, if nothing cites it, she is the
     * one who added it.
     */
    private function isOnlyHers(User $user, BibliographyItem $item): bool
    {
        $references = $item->references()->with(['edition:id,user_id', 'conjecture:id,user_id'])->get();

        if ($references->isEmpty()) {
            return $item->user_id === $user->id;
        }

        return $references->every(function (BibliographyReference $reference) use ($user): bool {
            $owner = $reference->conjecture_id !== null
                ? $reference->conjecture?->user_id
                : $reference->edition?->user_id;

            return $owner === $user->id;
        });
    }
}
