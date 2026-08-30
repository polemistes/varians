<?php

namespace App\Enums;

enum Role: string
{
    case Guest = 'guest';
    case Editor = 'editor';
    case Administrator = 'administrator';

    /**
     * Whether this role satisfies at least the given minimum role level.
     * Administrator > Editor > Guest.
     */
    public function atLeast(Role $minimum): bool
    {
        $order = [self::Guest, self::Editor, self::Administrator];

        return array_search($this, $order, true) >= array_search($minimum, $order, true);
    }
}
