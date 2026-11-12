/**
 * What the editor draws over the text: marks by kind, unchecked and joined
 * tokens, objects as widgets, page and column starts as rules with their
 * labels, segment labels where a run begins in the middle of a line, and
 * the name of the language before the first word shown and every word
 * whose language differs from the word before it. Everything is recomputed from the model; nothing here is stored.
 */

import type { Range } from '@codemirror/state';
import { Decoration, WidgetType, type DecorationSet } from '@codemirror/view';
import {
  isBreak,
  isNotTranscribed,
  isToken,
  shownBreaks,
  variantGroup,
  type Break,
  type Id,
  type Item,
  type Mark,
  type Obj,
  type SegmentStart,
  type Shown,
} from '@varians/core';
import { languageName } from '../registry/languages.ts';
import { editor as editorText } from '../strings/editor.ts';
import { breakLabels, editorStrings, objectLabels } from './labels.ts';
import { lineIndex, type LineInfo } from './lines.ts';
import type { Model } from './model.ts';
import { utf16Offset } from './unicode.ts';

/** The event an inline segment label sends up the DOM when clicked; `detail` is the token id. */
export const SEGMENT_CLICK_EVENT = 'varians-segment';

const lineCache = new WeakMap<Model, LineInfo[]>();

/** The lines of a model, computed once per model. */
export function linesOf(model: Model): LineInfo[] {
  let lines = lineCache.get(model);
  if (!lines) {
    lines = lineIndex(model.ledger, model.byId);
    lineCache.set(model, lines);
  }
  return lines;
}

const shownCache = new WeakMap<Model, Shown>();

/**
 * What the model shows of its breaks: the words divided by the end of a line
 * that is shown, which are written with a hyphen there, and the breaks that
 * are not shown. A transcript shows every break; in an edition the line
 * breaks of a prose paragraph are not shown and no word of one is hyphenated.
 */
export function shownOf(model: Model): Shown {
  let shown = shownCache.get(model);
  if (!shown) {
    const items = model.view.stream.items;
    const found = shownBreaks(items, model.lineation ?? 'verse');
    const hidden = model.lineation === null ? new Set<Id>() : found.hidden;
    // A word the shown text ends with is divided by the page break that follows it.
    const last = items[items.length - 1];
    if (model.view.trailingBreak && isToken(last) && last.joinNext) found.hyphens.add(last.id);
    shown = { hyphens: found.hyphens, hidden };
    shownCache.set(model, shown);
  }
  return shown;
}

export function segmentLabel(model: Model, segment: SegmentStart): string {
  if (segment.segmentId === null) return editorStrings.unassignedShort;
  return model.segmentLabels[segment.segmentId] ?? segment.segmentId;
}

/** A page break names no page whose label the editor was given: the stream was not conformed, or the labels are stale. */
export class MissingPageLabel extends Error {
  constructor(readonly pageId: string | undefined) {
    super(`page break names no page with a label: ${pageId ?? '(none)'}`);
    this.name = 'MissingPageLabel';
  }
}

/**
 * The label of the page a page break names. Every page break names a page
 * of the witness (the stream is conformed on every write), so a missing
 * label is a programming error: in development and tests it throws; in
 * production the word "page" stands in, never the page's id.
 */
export function pageLabel(model: Model, brk: Break): string {
  const label = brk.pageId ? model.pageLabels[brk.pageId] : undefined;
  if (label !== undefined) return label;
  if (import.meta.env?.DEV !== false) throw new MissingPageLabel(brk.pageId);
  return breakLabels.page!;
}

export function gapLabel(obj: Obj): string {
  // A stretch not transcribed is not a loss in the carrier: it does not wear the brackets of one.
  if (isNotTranscribed(obj.attrs)) return editorText.gapNotTranscribed;
  const quantity = obj.attrs?.quantity;
  if (typeof quantity === 'number') {
    const unit = obj.attrs?.unit === 'line' ? editorStrings.gapLines : '';
    return editorStrings.gapQuantity.replace('{n}', String(quantity)).replace('{unit}', unit);
  }
  return editorStrings.gapUnknown;
}

export function objectLabel(obj: Obj): string {
  switch (obj.type) {
    case 'gap':
      return gapLabel(obj);
    case 'paratext':
      return obj.text || objectLabels.paratext!;
    default:
      return objectLabels[obj.type] ?? obj.type;
  }
}

class ObjectWidget extends WidgetType {
  constructor(
    readonly obj: Obj,
    readonly label: string,
  ) {
    super();
  }

  override eq(other: ObjectWidget): boolean {
    return (
      other.obj.id === this.obj.id && other.obj.type === this.obj.type && other.label === this.label
    );
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = `cm-object cm-object-${this.obj.type}`;
    if (this.obj.type === 'gap' && isNotTranscribed(this.obj.attrs))
      span.classList.add('cm-object-untranscribed');
    span.textContent = this.label;
    span.dataset.id = this.obj.id;
    return span;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

class HyphenWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-join-hyphen';
    span.textContent = '-';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}

/** What stands where a line break is not shown: the space between two words, or nothing inside a word. */
class RunOnWidget extends WidgetType {
  constructor(readonly space: boolean) {
    super();
  }

  override eq(other: RunOnWidget): boolean {
    return other.space === this.space;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-run-on';
    span.textContent = this.space ? ' ' : '';
    return span;
  }
}

class SegmentLabelWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly tokenId: Id,
  ) {
    super();
  }

  override eq(other: SegmentLabelWidget): boolean {
    return other.label === this.label && other.tokenId === this.tokenId;
  }

  toDOM(): HTMLElement {
    const sup = document.createElement('sup');
    sup.className = 'cm-segment-inline';
    sup.textContent = this.label;
    sup.title = editorStrings.setSegment;
    sup.addEventListener('click', (event) => {
      event.preventDefault();
      sup.dispatchEvent(
        new CustomEvent(SEGMENT_CLICK_EVENT, { bubbles: true, detail: this.tokenId }),
      );
    });
    return sup;
  }
}

/** The name of the language a stretch of words is in, before its first word. */
class LanguageLabelWidget extends WidgetType {
  constructor(readonly lang: string) {
    super();
  }

  override eq(other: LanguageLabelWidget): boolean {
    return other.lang === this.lang;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-language-label';
    // Drawn from the attribute, so that the name is not part of the text copied or read back.
    span.dataset.label = languageName(this.lang);
    span.dataset.lang = this.lang;
    return span;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

class BreakWidget extends WidgetType {
  constructor(
    readonly type: 'page' | 'column',
    readonly label: string,
  ) {
    super();
  }

  override eq(other: BreakWidget): boolean {
    return other.type === this.type && other.label === this.label;
  }

  toDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = `cm-break-widget cm-break-${this.type}`;
    const span = document.createElement('span');
    span.className = 'cm-break-label';
    span.textContent = this.label;
    div.appendChild(span);
    return div;
  }

  override get estimatedHeight(): number {
    return 36;
  }
}

/** Whether the stream shown has text before its first page break and a page break after it. */
function leadsUnplaced(model: Model): boolean {
  let content = false;
  for (const item of model.view.stream.items) {
    if (isBreak(item) && item.type === 'page') return content;
    if (!isBreak(item)) content = true;
  }
  return false;
}

/** The tokens that end the words of a variant noted in the carrier: its indicator stands after them. */
export function variantEnds(items: readonly Item[]): Set<Id> {
  const ends = new Set<Id>();
  let last: { id: Id; group: string | undefined } | null = null;
  const close = (next: string | undefined) => {
    if (last?.group !== undefined && last.group !== next) ends.add(last.id);
  };
  for (const item of items) {
    if (isToken(item)) {
      const group = variantGroup(item);
      close(group);
      last = { id: item.id, group };
    } else if (item.kind === 'object' && item.type === 'gap') {
      close(undefined);
      last = null;
    }
  }
  close(undefined);
  return ends;
}

function variantTitle(mark: Mark): string {
  const reading = typeof mark.attrs?.reading === 'string' ? mark.attrs.reading : '';
  const place =
    editorStrings.variantPlaces[String(mark.attrs?.place ?? 'other')] ??
    editorStrings.variantPlaces.other!;
  return editorStrings.variantTitle(reading, place);
}

/**
 * The line breaks the editor does not show, and the spaces that stand for
 * nothing, as replaced ranges: the document keeps its newline where the text
 * has its break, and the view puts a space there (or nothing, inside a word),
 * the lines on either side being one line. The caret skips such a range as it
 * skips one character. A break between a word and the next that it joins with
 * no break between them (a word divided where a segment begins) hides the space
 * the document has there, so that the word is one word. The text that opens
 * with a paragraph break does not show an empty line above it.
 */
export function buildRunOn(model: Model): DecorationSet {
  if (model.misaligned) return Decoration.none;
  const shown = shownOf(model);
  const spans = model.ledger.spans;
  const ranges: Range<Decoration>[] = [];
  const hide = (from: number, to: number, space: boolean) =>
    ranges.push(Decoration.replace({ widget: new RunOnWidget(space) }).range(from, to));
  const joins = (span: (typeof spans)[number] | undefined): boolean => {
    const item = span ? model.byId.get(span.id) : undefined;
    return isToken(item) && item.joinNext === true;
  };
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!;
    if (span.kind === 'break') {
      const item = model.byId.get(span.id);
      if (i === 0 && model.lineation !== null && isBreak(item) && item.type === 'paragraph') {
        hide(span.from, span.to, false);
        continue;
      }
      if (!shown.hidden.has(span.id)) continue;
      // The breaks in a row that are not shown stand for one space between the words either side.
      let last = i;
      while (spans[last + 1]?.kind === 'break' && shown.hidden.has(spans[last + 1]!.id)) last++;
      const before = spans[i - 1];
      const after = spans[last + 1];
      if (before && after && before.kind !== 'break' && after.kind !== 'break')
        hide(before.to, after.from, !joins(before));
      else hide(span.from, spans[last]!.to, false);
      i = last;
      continue;
    }
    const next = spans[i + 1];
    if (joins(span) && next?.kind === 'token' && next.from > span.to)
      hide(span.to, next.from, false);
  }
  return Decoration.set(ranges, true);
}

/**
 * Where a stretch of words in one language begins among the words shown:
 * the first word with a language, and every word whose language differs
 * from the word before it, across line breaks and objects. A word without
 * a language begins none.
 */
export function languageStarts(model: Model): { id: Id; from: number; lang: string }[] {
  const out: { id: Id; from: number; lang: string }[] = [];
  let previous: string | undefined;
  for (const span of model.ledger.spans) {
    if (span.kind !== 'token') continue;
    const item = model.byId.get(span.id);
    if (!isToken(item)) continue;
    if (item.lang !== undefined && item.lang !== previous)
      out.push({ id: item.id, from: span.from, lang: item.lang });
    previous = item.lang;
  }
  return out;
}

/** The decorations of a model. `perLineDirection` adds `dir=auto` to every line. */
export function buildDecorations(model: Model, perLineDirection: boolean): DecorationSet {
  if (model.misaligned) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  const lines = linesOf(model);
  const shown = shownOf(model);
  for (const line of lines) {
    // A line that a break not shown joins to the line above is part of that line.
    const continued = line.opener !== null && shown.hidden.has(line.opener.id);
    if (continued) {
      for (const start of line.starts) {
        const widget = new SegmentLabelWidget(segmentLabel(model, start.segment), start.span.id);
        ranges.push(Decoration.widget({ widget, side: -1 }).range(start.span.from));
      }
      continue;
    }
    const attributes: Record<string, string> = {};
    const classes: string[] = [];
    if (perLineDirection) attributes.dir = 'auto';
    const opener = line.opener
      ? model.byId.get(line.opener.id)
      : line.from === 0
        ? model.view.anchor
        : undefined;
    if (line.from === 0 && model.page === null && !opener && leadsUnplaced(model)) {
      // The text on no page, in the whole text of a transcript with pages.
      const widget = new BreakWidget('page', editorStrings.notOnAPage);
      ranges.push(Decoration.widget({ widget, block: true, side: -1 }).range(line.from));
    }
    if (opener && opener.kind === 'break') {
      if (opener.type === 'page') {
        // A page shown alone has no heading in its text; the whole text puts each page under its label.
        classes.push('cm-page-start');
        if (model.page === null) {
          const widget = new BreakWidget('page', pageLabel(model, opener));
          ranges.push(Decoration.widget({ widget, block: true, side: -1 }).range(line.from));
        }
      } else if (opener.type === 'column') {
        classes.push('cm-column-start');
        const widget = new BreakWidget('column', opener.label ?? breakLabels.column!);
        ranges.push(Decoration.widget({ widget, block: true, side: -1 }).range(line.from));
      } else if (opener.type === 'paragraph') {
        classes.push('cm-paragraph-start');
      }
    }
    if (classes.length) attributes.class = classes.join(' ');
    if (Object.keys(attributes).length)
      ranges.push(Decoration.line({ attributes }).range(line.from));
    for (const start of line.starts) {
      if (start.span === line.first) continue;
      const widget = new SegmentLabelWidget(segmentLabel(model, start.segment), start.span.id);
      ranges.push(Decoration.widget({ widget, side: -1 }).range(start.span.from));
    }
  }
  for (const start of languageStarts(model)) {
    // Before the segment label that may stand at the same word.
    const widget = new LanguageLabelWidget(start.lang);
    ranges.push(Decoration.widget({ widget, side: -2 }).range(start.from));
  }
  const ends = variantEnds(model.view.stream.items);
  for (const span of model.ledger.spans) {
    const item = model.byId.get(span.id);
    if (!item || span.kind === 'break') continue;
    if (item.kind === 'object') {
      if (span.to > span.from) {
        ranges.push(
          Decoration.replace({ widget: new ObjectWidget(item, objectLabel(item)) }).range(
            span.from,
            span.to,
          ),
        );
      }
      continue;
    }
    if (!isToken(item) || span.to <= span.from) continue;
    const classes = ['cm-token'];
    if (item.unchecked) classes.push('cm-unchecked');
    if (item.joinNext) classes.push('cm-joined');
    if (shown.hyphens.has(item.id))
      ranges.push(Decoration.widget({ widget: new HyphenWidget(), side: 1 }).range(span.to));
    ranges.push(
      Decoration.mark({ class: classes.join(' '), attributes: { 'data-token': item.id } }).range(
        span.from,
        span.to,
      ),
    );
    const rangesAllowed = !(model.form === 'read' && item.norm !== undefined);
    for (const mark of item.marks ?? []) {
      if (mark.kind === 'variant') {
        // Always the whole word; the indicator stands after the last word of the variant.
        const cls = `cm-mark cm-mark-variant${ends.has(item.id) ? ' cm-mark-variant-end' : ''}`;
        ranges.push(
          Decoration.mark({
            class: cls,
            attributes: { 'data-kind': 'variant', title: variantTitle(mark) },
          }).range(span.from, span.to),
        );
        continue;
      }
      const cls = `cm-mark cm-mark-${mark.kind}`;
      let from = span.from;
      let to = span.to;
      if (rangesAllowed && mark.from !== undefined && mark.to !== undefined) {
        const a = span.from + utf16Offset(item.form, mark.from);
        const b = span.from + utf16Offset(item.form, mark.to);
        if (b > a && b <= span.to) {
          from = a;
          to = b;
        }
      }
      ranges.push(
        Decoration.mark({ class: cls, attributes: { 'data-kind': mark.kind } }).range(from, to),
      );
    }
  }
  return Decoration.set(ranges, true);
}
