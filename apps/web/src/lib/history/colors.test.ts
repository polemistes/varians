import { describe, expect, it } from 'vitest';
import { AUTHOR_PALETTE_SIZE, assignSlots, authorColor, authorSlot, hashId } from './colors.ts';

describe('author colours', () => {
  it('gives an id the same slot every time, inside the palette', () => {
    for (const id of ['01M3YQNMYW4H7KKK2A3BK9Y5DW', '01M3YPND1RWV6GGY6RQQACACB2', 'x', '']) {
      const slot = authorSlot(id);
      expect(authorSlot(id)).toBe(slot);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(AUTHOR_PALETTE_SIZE);
    }
    expect(hashId('abc')).toBe(hashId('abc'));
    expect(authorColor('x')).toBe(`var(--author-${authorSlot('x')})`);
  });

  it('spreads ids over the whole palette', () => {
    const slots = new Set(Array.from({ length: 60 }, (_, i) => authorSlot(`user-${i}`)));
    expect(slots.size).toBe(AUTHOR_PALETTE_SIZE);
  });

  it('keeps a person on their own slot when no one else has it', () => {
    expect(assignSlots(['only']).get('only')).toBe(authorSlot('only'));
  });

  it('gives the people of one document different colours, whatever order they come in', () => {
    // Two ids that hash to the same slot still get different colours.
    const ids = Array.from({ length: 40 }, (_, i) => `u${i}`);
    const first = ids[0]!;
    const clash = ids.find((id) => id !== first && authorSlot(id) === authorSlot(first))!;
    expect(clash).toBeDefined();
    const pair = assignSlots([first, clash]);
    expect(pair.get(first)).not.toBe(pair.get(clash));

    const seven = ids.slice(0, AUTHOR_PALETTE_SIZE);
    const forward = assignSlots(seven);
    expect(new Set(forward.values()).size).toBe(AUTHOR_PALETTE_SIZE);
    const backward = assignSlots([...seven].reverse());
    expect([...backward.entries()].sort()).toEqual([...forward.entries()].sort());
  });

  it('shares slots only when there are more people than colours', () => {
    const many = assignSlots(Array.from({ length: AUTHOR_PALETTE_SIZE + 3 }, (_, i) => `p${i}`));
    expect(many.size).toBe(AUTHOR_PALETTE_SIZE + 3);
    for (const slot of many.values()) expect(slot).toBeLessThan(AUTHOR_PALETTE_SIZE);
  });
});
