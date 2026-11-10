import { describe, expect, it } from 'vitest';
import {
  afterRedo,
  afterUndo,
  emptyHistory,
  nextRedo,
  nextUndo,
  recordAction,
  type ZoneAction,
} from './zone-history.ts';

const action = (pageId: string, label: string): ZoneAction => ({
  pageId,
  label,
  undo: async () => true,
  redo: async () => true,
});

describe('zone history', () => {
  it('undoes the last action of the page shown, and redoes it', () => {
    let h = emptyHistory();
    h = recordAction(h, action('p1', 'make 3 boxes'));
    h = recordAction(h, action('p2', 'move 2 boxes'));
    h = recordAction(h, action('p1', 'delete 1 box'));
    expect(nextUndo(h, 'p1')?.label).toBe('delete 1 box');
    h = afterUndo(h, nextUndo(h, 'p1')!);
    expect(nextUndo(h, 'p1')?.label).toBe('make 3 boxes');
    expect(nextRedo(h, 'p1')?.label).toBe('delete 1 box');
    expect(nextRedo(h, 'p2')).toBeNull();
    h = afterRedo(h, nextRedo(h, 'p1')!);
    expect(nextUndo(h, 'p1')?.label).toBe('delete 1 box');
    expect(nextRedo(h, 'p1')).toBeNull();
  });

  it('forgets what was undone on a page once something new is done there', () => {
    let h = recordAction(recordAction(emptyHistory(), action('p1', 'a')), action('p2', 'b'));
    h = afterUndo(h, nextUndo(h, 'p1')!);
    h = afterUndo(h, nextUndo(h, 'p2')!);
    h = recordAction(h, action('p1', 'c'));
    expect(nextRedo(h, 'p1')).toBeNull();
    expect(nextRedo(h, 'p2')?.label).toBe('b');
  });

  it('has nothing to undo without a page', () => {
    expect(nextUndo(recordAction(emptyHistory(), action('p1', 'a')), null)).toBeNull();
  });
});
