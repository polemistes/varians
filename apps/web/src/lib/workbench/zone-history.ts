/**
 * Undo and redo for the boxes on the images: making, moving,
 * resizing and deleting them. Each page has its own history; an entry
 * carries what undoes it and what does it again. Pure: the owner keeps the
 * history in its state and runs the entries.
 */

export interface ZoneAction {
  pageId: string;
  /** What was done, for the buttons' titles: "move 8 boxes". */
  label: string;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
}

export interface ZoneHistory {
  done: ZoneAction[];
  undone: ZoneAction[];
}

export const HISTORY_DEPTH = 100;

export const emptyHistory = (): ZoneHistory => ({ done: [], undone: [] });

/** A new action: what was undone on its page can no longer be redone. */
export function recordAction(history: ZoneHistory, action: ZoneAction): ZoneHistory {
  return {
    done: [...history.done, action].slice(-HISTORY_DEPTH),
    undone: history.undone.filter((a) => a.pageId !== action.pageId),
  };
}

function lastOf(actions: ZoneAction[], pageId: string): number {
  for (let i = actions.length - 1; i >= 0; i--) if (actions[i]!.pageId === pageId) return i;
  return -1;
}

/** The action an undo on the page would take back. */
export function nextUndo(history: ZoneHistory, pageId: string | null): ZoneAction | null {
  if (!pageId) return null;
  const i = lastOf(history.done, pageId);
  return i < 0 ? null : history.done[i]!;
}

/** The action a redo on the page would do again. */
export function nextRedo(history: ZoneHistory, pageId: string | null): ZoneAction | null {
  if (!pageId) return null;
  const i = lastOf(history.undone, pageId);
  return i < 0 ? null : history.undone[i]!;
}

/** The history once the page's last action is undone: it moves to the redo side. */
export function afterUndo(history: ZoneHistory, action: ZoneAction): ZoneHistory {
  return { done: history.done.filter((a) => a !== action), undone: [...history.undone, action] };
}

/** The history once the page's last undone action is done again. */
export function afterRedo(history: ZoneHistory, action: ZoneAction): ZoneHistory {
  return { done: [...history.done, action], undone: history.undone.filter((a) => a !== action) };
}
