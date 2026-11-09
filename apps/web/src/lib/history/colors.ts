/**
 * A stable colour per person, from a small palette: the same user id always
 * gets the same slot, within one document and across them. The palette
 * itself is CSS (custom properties --author-0 .. --author-N on the panel, with
 * light and dark values); this module only chooses the slot.
 */

export const AUTHOR_PALETTE_SIZE = 7;

/** FNV-1a over the id's UTF-16 code units: cheap, stable, well spread for ULIDs. */
export function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The palette slot of a user id, 0 to size - 1. */
export function authorSlot(userId: string, size = AUTHOR_PALETTE_SIZE): number {
  if (!userId) return 0;
  return hashId(userId) % Math.max(1, size);
}

/** The CSS value for a user's colour: `var(--author-3)`. */
export function authorColor(userId: string, size = AUTHOR_PALETTE_SIZE): string {
  return `var(--author-${authorSlot(userId, size)})`;
}

/**
 * Slots for a set of people, avoiding collisions where the palette allows:
 * each person keeps their hashed slot unless someone earlier in the list
 * took it, in which case the next free slot is used. Order the list stably
 * (by user id) so that the result does not change between loads.
 */
export function assignSlots(userIds: Iterable<string>, size = AUTHOR_PALETTE_SIZE): Map<string, number> {
  const ids = [...new Set(userIds)].sort();
  const taken = new Set<number>();
  const out = new Map<string, number>();
  for (const id of ids) {
    let slot = authorSlot(id, size);
    if (ids.length <= size) {
      let tries = 0;
      while (taken.has(slot) && tries < size) {
        slot = (slot + 1) % size;
        tries++;
      }
    }
    taken.add(slot);
    out.set(id, slot);
  }
  return out;
}
