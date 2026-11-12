/**
 * The language of the words in an editor's host (the workbench, the
 * edition editor): the language in force at the caret, choosing one for
 * the selected words or for what is typed next, and the chooser that a
 * word typed where no language is in force opens.
 *
 * Operations from the editor go through `receive`. Those that would bring
 * in a word without a language are held, not passed on: the chooser asks,
 * and on a choice they are passed on with the words given the language
 * chosen; on cancel the editor is made anew from the host's text, which
 * never had them, so that the words typed are taken back.
 */

import { applyOps, type Id, type Op, type Stream } from '@varians/core';
import type { EditorApi } from '$lib/editor/editor';
import { languageOps, languagesInOrder, unlanguagedIn, withLanguage } from '$lib/editor/language';

export interface LanguageHost {
  /** The host's text. */
  stream(): Stream;
  api(): EditorApi | null;
  /** The words selected as a range; none when there is only a caret. */
  selected(): Id[];
  /** Pass on operations the editor made, with the stream they produce from the host's. */
  pass(ops: Op[], next: Stream): void;
  /** Apply operations of the host's own: the language of selected words. */
  apply(ops: Op[]): void;
  /** Make the editor anew from the host's text. */
  rebuild(): void;
}

export class EditorLanguage {
  /** The language in force at the caret, as the editor reports it; null where there is none. */
  current = $state<string | null>(null);
  /** The chooser is open: operations wait for its answer. */
  asking = $state(false);
  /** The window for a language tag of one's own is open. */
  otherOpen = $state(false);

  private readonly host: LanguageHost;
  private held: Op[] = [];

  constructor(host: LanguageHost) {
    this.host = host;
  }

  /** The languages already in the text, in the order they first occur. */
  get inText(): string[] {
    return languagesInOrder(this.host.stream().items);
  }

  /** The editor made operations: they are passed on, or held while the chooser asks. True when held. */
  receive(ops: Op[], next: Stream): boolean {
    if (this.asking) {
      this.held.push(...ops);
      return true;
    }
    if (unlanguagedIn(ops).length === 0) {
      this.host.pass(ops, next);
      return false;
    }
    this.held = [...ops];
    this.asking = true;
    return true;
  }

  /**
   * A language chosen in the menu or its window: the selected words take it,
   * or, with none selected, what is typed next.
   */
  choose(lang: string): void {
    const selected = this.host.selected();
    if (selected.length) {
      const ops = languageOps(this.host.stream(), selected, lang);
      if (ops.length) this.host.apply(ops);
      return;
    }
    this.host.api()?.setTypingLanguage(lang);
    this.current = lang;
  }

  /** The chooser's answer: the words held take the language, which the next words typed take too. */
  answer(lang: string): void {
    const ops = withLanguage(this.held, lang);
    this.held = [];
    this.asking = false;
    try {
      this.host.pass(ops, applyOps(this.host.stream(), ops).stream);
    } catch (error) {
      console.error('[language] the words typed could not be given their language', error);
      this.host.rebuild();
      return;
    }
    this.host.api()?.setTypingLanguage(lang);
    this.focus();
  }

  /** Back to the text, once a menu or a window has let go of the focus. */
  focus(): void {
    setTimeout(() => this.host.api()?.focus(), 0);
  }

  /** The chooser was cancelled: the words typed are taken back. */
  cancel(): void {
    if (!this.asking) return;
    this.held = [];
    this.asking = false;
    this.current = null;
    this.host.rebuild();
  }
}
