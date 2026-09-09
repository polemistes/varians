<?php

namespace App\Enums;

/**
 * A user's site-wide standing. It does not decide what a member may create
 * — every registered user creates and owns works, witnesses, editions and
 * conjectures — only what she may do to OTHER people's material:
 *
 * - Member: her own things, and whatever an edition owner has granted her.
 * - Editor: may edit anything anyone owns, but neither delete it nor hand
 *   out privileges or ownership over it.
 * - Administrator: may do everything to everything, including managing
 *   roles.
 *
 * See the policies in App\Policies for how this combines with ownership
 * and per-edition grants.
 */
enum Role: string
{
    case Member = 'member';
    case Editor = 'editor';
    case Administrator = 'administrator';

    /**
     * Whether this role satisfies at least the given minimum role level.
     * Administrator > Editor > Member.
     */
    public function atLeast(Role $minimum): bool
    {
        $order = [self::Member, self::Editor, self::Administrator];

        return array_search($this, $order, true) >= array_search($minimum, $order, true);
    }
}
