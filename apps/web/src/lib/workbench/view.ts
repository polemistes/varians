/**
 * Small pure pieces of the workbench's screen: where a floating toolbar
 * stands, how many lines a page has, and what a conflict set aside.
 */

import { gapText, isBreak, isObj, isToken, lines, type Op, type Stream } from '@varians/core';

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Frame {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Where a floating element of `size` stands relative to `container`: under
 * the anchor (a selection, in viewport coordinates), or above it when there
 * is no room below, its left edge with the anchor's and kept inside.
 */
export function floatingPosition(
  anchor: Box,
  container: Frame,
  size: { width: number; height: number },
  gap = 8,
): { top: number; left: number; placement: 'below' | 'above' } {
  const below = anchor.bottom - container.top + gap;
  const above = anchor.top - container.top - gap - size.height;
  const fitsBelow = below + size.height <= container.height;
  const placement = fitsBelow || above < 0 ? 'below' : 'above';
  const top =
    placement === 'below' ? Math.min(below, Math.max(0, container.height - size.height)) : above;
  const maxLeft = Math.max(gap, container.width - size.width - gap);
  const left = Math.min(Math.max(anchor.left - container.left, gap), maxLeft);
  return { top: Math.max(0, top), left, placement };
}

/** Lines of a page that hold words or objects. */
export function lineCount(stream: Stream): number {
  let n = 0;
  for (const line of lines(stream)) {
    for (let i = line.from; i < line.to; i++) {
      const item = stream.items[i];
      if (isToken(item) || isObj(item)) {
        n++;
        break;
      }
    }
  }
  return n;
}

export interface SetAside {
  /** Words typed or changed that were set aside, as they read. */
  words: string[];
  /** Items whose removal was set aside. */
  removed: number;
  /** Other changes (marks, joins, segment starts, breaks). */
  other: number;
}

/** What a list of operations set aside at a conflict did, in words a person can check. */
export function describeSetAside(ops: Op[]): SetAside {
  const words: string[] = [];
  let removed = 0;
  let other = 0;
  for (const op of ops) {
    switch (op.t) {
      case 'insert':
      case 'replace':
        for (const item of op.items) {
          if (isToken(item)) words.push(item.norm ?? item.form);
          else if (!isBreak(item)) other++;
        }
        if (op.t === 'replace') removed += op.ids.length;
        break;
      case 'delete':
        removed += op.ids.length;
        break;
      case 'set': {
        const value = op.fields.norm ?? op.fields.form;
        if (typeof value === 'string') words.push(value);
        else other++;
        break;
      }
      default:
        other++;
    }
  }
  return { words: [...new Set(words)], removed, other };
}

/**
 * The written form without word division: the words of each line
 * run together as the witness writes them, with a space or an interpunct
 * only where one is recorded before a word.
 */
export function asWrittenLines(stream: Stream): string[] {
  return lines(stream).map((line) => {
    let out = '';
    for (let i = line.from; i < line.to; i++) {
      const item = stream.items[i]!;
      if (isToken(item)) {
        if (out && item.sep === 'interpunct') out += '·';
        else if (out && item.sep === 'space') out += ' ';
        out += item.form;
      } else if (isObj(item) && item.type === 'gap') out += gapText(item.attrs ?? {});
    }
    return out;
  });
}
