/**
 * The transcription editor over CodeMirror.
 *
 * `VariansEditor` owns the view and the whole stream, keeps the model (the
 * page shown, its ledger) in the editor state, turns every document change
 * into operations for the parent, and exposes the commands a toolbar or a
 * shortcut needs. The Svelte component is a thin shell around it.
 */

import {
  defaultKeymap,
  deleteCharBackward,
  history,
  historyKeymap,
  insertNewline,
  isolateHistory,
  redo as redoCommand,
  undo as undoCommand,
} from '@codemirror/commands';
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  Transaction,
  type Extension,
  type StateEffect,
} from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  GutterMarker,
  gutter,
  hoverTooltip,
  keymap,
  lineNumbers,
  type BlockInfo,
  type KeyBinding,
  type Tooltip,
  type ViewUpdate,
} from '@codemirror/view';
import {
  applyOps,
  isNotTranscribed,
  isToken,
  newId,
  NOT_TRANSCRIBED_ATTRS,
  type Break,
  type Id,
  type Item,
  type Obj,
  type ObjectType,
  type Op,
  type Stream,
  type Token,
} from '@varians/core';
import { editor as editorText } from '../strings/editor.ts';
import { minimalChange } from './align.ts';
import { setJoin, spanOf, type Form } from './bridge.ts';
import {
  linesOf,
  objectLabel,
  pageLabel,
  SEGMENT_CLICK_EVENT,
  segmentLabel,
} from './decorations.ts';
import { backspaceUnjoin, hyphenEnter, joinLinesEdit, spanContaining } from './hyphen.ts';
import { editorStrings, markLabels, objectLabels } from './labels.ts';
import { lineAt, type BreakTarget, type BreakType } from './lines.ts';
import {
  addMarkOps,
  correctionIn,
  markTargets,
  setCorrectionOps,
  marksOfKind,
  removeMarkOps,
  removeVariantOps,
  setVariantOps,
  variantSpanned,
  variantsIn,
  type MarkAttrs,
  type MarkTarget,
  type CorrectionAttrs,
  type CorrectionFound,
  type VariantAttrs,
  type VariantFound,
} from './marks.ts';
import { setTokenClasses, tokenClassField, type TokenClasses } from './highlight.ts';
import { marginGutter, marginMarksField, setMarginMarks, type MarginMark } from './margin.ts';
import { buildModel, type Model, type ModelOptions } from './model.ts';
import { breakAt, breakPreview, setBreakPreview, type BreakPreview } from './preview.ts';
import { planInsertion, selectionTokens, tokenAt, tokenSpanAt } from './selection.ts';
import {
  editIntent,
  modelEdit,
  modelExtensions,
  modelField,
  setModel,
  wholeEdit,
} from './state.ts';

export type Direction = 'auto' | 'ltr' | 'rtl';

export interface EditorProps {
  stream: Stream;
  form: Form;
  readonly?: boolean;
  /** Show one page by its id, the text on no page (`'unplaced'`), or the whole stream (null). */
  page?: string | null;
  /** The witness's pages in order, so that a page's break is made in its place. */
  pageOrder?: readonly string[];
  direction?: Direction;
  lineNumbers?: boolean;
  segmentLabels?: Record<string, string>;
  pageLabels?: Record<string, string>;
  /** Classes to put on tokens: highlights the host decides (variant sites, a hovered zone's words). */
  tokenClasses?: TokenClasses;
  /** Marks in a margin between lines, each after the line of an item; no margin when absent. */
  marginMarks?: MarginMark[];
  /** The name of a hand as a mark records it, for tooltips; the value itself when absent. */
  handLabel?: (value: string) => string;
}

export interface EditorCallbacks {
  /** After every edit: the operations and the stream they produce. The parent passes `next` back as `stream`. */
  onops?: (ops: Op[], next: Stream) => void;
  onselection?: (tokenIds: Id[], caretTokenId: Id | null) => void;
  ontokenhover?: (tokenId: Id | null) => void;
  /** The user asked to set or change the segment that begins at this token; `current` is the label shown there. */
  onrequestsegment?: (tokenId: Id, current: string | null) => void;
  /** Text is about to be cut: what it takes. The cut itself goes on as usual. */
  oncut?: (cut: CutRecord) => void;
  /** Text was copied. */
  oncopy?: () => void;
  /** Text is about to be pasted: true when the parent put it in itself, and the editor's own paste is not made. */
  onpaste?: (text: string) => boolean;
  /** A word was double-clicked in a read-only text. */
  onworddblclick?: (tokenId: Id) => void;
  /** A mark in the margin between lines was clicked: its key. */
  onmarginmark?: (key: string) => void;
}

/** What a cut takes from the text shown. */
export interface CutRecord {
  /** The items the selection touches, in order, as they stand before the cut. */
  items: Item[];
  /** The text the clipboard will hold. */
  text: string;
  /** The selection covers whole items only: no word is divided by it. */
  whole: boolean;
}

export interface EditorApi {
  /** Mark the selection: whole tokens where it covers whole words, a range of the written form inside one word. */
  applyMark(kind: string, attrs?: MarkAttrs): boolean;
  removeMark(kind: string): boolean;
  /** Apply the mark unless every token of the selection carries it already; then remove it. */
  toggleMark(kind: string, attrs?: MarkAttrs): boolean;
  hasMark(kind: string): boolean;
  /** The variant noted in the carrier at the selection (the first, where it touches several), and whether the selection is exactly its words. */
  variantAtSelection(): (VariantFound & { exact: boolean }) | null;
  /** Note a variant over the selected words (whole words); where they are exactly one variant's words, that variant is changed. */
  setVariant(variant: VariantAttrs): boolean;
  /** Remove the variants the selection touches, from all their words. */
  removeVariant(): boolean;
  /** The deletions and additions the selection touches, with the hand and stage they carry. */
  correctionAtSelection(): CorrectionFound | null;
  /** Give the deletions and additions of the selection a hand and a stage. */
  setCorrection(attrs: CorrectionAttrs): boolean;
  /** Insert an object at the caret: after the word the caret stands in, or dividing it. */
  insertObject(type: ObjectType, attrs?: MarkAttrs, text?: string): boolean;
  /**
   * Begin a column or paragraph with the caret's line: the break goes
   * before the line, wherever in it the caret stands. A line break is Enter.
   */
  insertBreak(type: BreakType): boolean;
  /** The caret's line, and what each kind of break would do there; null when no break can be made. */
  breakChoices(): BreakChoices | null;
  /** Show where a break would go (`any`: any kind), or stop showing it (null). */
  previewBreak(preview: BreakPreview): void;
  /** Toggle whether the last word of the caret's line continues on the next line. */
  setJoinAtCaret(): boolean;
  /** Ask the parent for the segment that begins at the word under the caret. */
  requestSegmentAtCaret(): boolean;
  /**
   * Apply operations to the whole stream, not only the text shown (text
   * moved to another page or brought from one), as one step the undo
   * history takes back.
   */
  applyWhole(ops: Op[]): boolean;
  /**
   * Where items put at the caret go in the whole stream: after the word the
   * caret stands in, else after the item before the caret (null: the very
   * start); `page` when the page shown has no break yet.
   */
  caretPlace(): { after: Id | null } | { page: string } | null;
  scrollToToken(id: Id): void;
  selectToken(id: Id): void;
  /** Put the caret at the start of a token, and bring it into view. */
  placeCaret(id: Id): void;
  /** Select from the start of one token to the end of another. */
  selectTokens(fromId: Id, toId: Id): void;
  /** Let go of the selection: the caret stays where it ends. */
  clearSelection(): void;
  /** Where the selection stands on screen, for placing a toolbar under it; null without a selection. */
  selectionRect(): { top: number; bottom: number; left: number; right: number } | null;
  focus(): void;
  tokenAtCaret(): Id | null;
  selectedTokens(): Id[];
  undo(): boolean;
  redo(): boolean;
}

export interface BreakChoices {
  /** The caret's line, numbered as in the gutter. */
  line: number;
  column: BreakTarget;
  paragraph: BreakTarget;
}

interface Settled {
  stream: Stream;
  form: Form;
  readonly: boolean;
  page: string | null;
  pageOrder: readonly string[];
  direction: Direction;
  lineNumbers: boolean;
  segmentLabels: Record<string, string>;
  pageLabels: Record<string, string>;
  tokenClasses: TokenClasses;
  marginMarks: MarginMark[] | null;
  handLabel?: (value: string) => string;
}

const NO_CLASSES: TokenClasses = {};
const NO_PAGES: readonly string[] = [];

function settle(props: EditorProps): Settled {
  return {
    stream: props.stream,
    form: props.form,
    readonly: props.readonly ?? false,
    page: props.page ?? null,
    pageOrder: props.pageOrder ?? NO_PAGES,
    direction: props.direction ?? 'auto',
    lineNumbers: props.lineNumbers ?? true,
    segmentLabels: props.segmentLabels ?? {},
    pageLabels: props.pageLabels ?? {},
    tokenClasses: props.tokenClasses ?? NO_CLASSES,
    marginMarks: props.marginMarks ?? null,
    ...(props.handLabel ? { handLabel: props.handLabel } : {}),
  };
}

function editableExtension(readonly: boolean): Extension {
  return [EditorView.editable.of(!readonly), EditorState.readOnly.of(readonly)];
}

function directionExtension(direction: Direction): Extension {
  if (direction === 'auto') return EditorView.perLineTextDirection.of(true);
  return EditorView.contentAttributes.of({ dir: direction });
}

class LabelMarker extends GutterMarker {
  constructor(
    readonly label: string,
    readonly tokenId: Id,
    readonly running: boolean,
  ) {
    super();
  }

  override eq(other: LabelMarker): boolean {
    return (
      other.label === this.label && other.tokenId === this.tokenId && other.running === this.running
    );
  }

  override toDOM(): Node {
    const span = document.createElement('span');
    span.className = this.running ? 'cm-segment-label cm-segment-running' : 'cm-segment-label';
    span.textContent = this.label;
    span.title = this.running ? editorStrings.runningSegment : editorStrings.setSegment;
    return span;
  }
}

/**
 * The segment run that gives a line its gutter label: at its first item,
 * else, on a page's first line, the segment running into the page (muted),
 * else the first run beginning on the line.
 */
export function lineLabel(
  model: Model,
  line: { from: number },
): { tokenId: Id; label: string; running: boolean } | null {
  const info = lineAt(linesOf(model), line.from);
  if (!info) return null;
  const own = info.starts.find((s) => s.span === info.first);
  if (!own && info.from === 0 && model.inherited && info.first) {
    return { tokenId: info.first.id, label: segmentLabel(model, model.inherited), running: true };
  }
  const start = own ?? info.starts[0];
  if (!start) return null;
  return { tokenId: start.span.id, label: segmentLabel(model, start.segment), running: false };
}

function attrsText(attrs: MarkAttrs | undefined): string {
  if (!attrs) return '';
  return Object.entries(attrs)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(', ');
}

/** A variant noted in the carrier as a tooltip row: where it stands, and what it reads. */
function variantRow(
  attrs: MarkAttrs | undefined,
  handLabel?: (value: string) => string,
): [string, string] {
  const place =
    editorStrings.variantPlaces[String(attrs?.place ?? 'other')] ??
    editorStrings.variantPlaces.other!;
  const reading = typeof attrs?.reading === 'string' ? attrs.reading : '';
  const hand =
    typeof attrs?.hand === 'string' && attrs.hand !== ''
      ? `; ${editorStrings.variantHand(handLabel ? handLabel(attrs.hand) : attrs.hand)}`
      : '';
  return [
    `${markLabels.variant} ${place}`,
    `${reading === '' ? editorStrings.variantOmits : reading}${hand}`,
  ];
}

/** The hand and stage of a deletion or an addition, then its other attributes. */
function correctionText(
  attrs: MarkAttrs | undefined,
  handLabel?: (value: string) => string,
): string {
  if (!attrs) return '';
  const parts: string[] = [];
  if (typeof attrs.hand === 'string' && attrs.hand !== '')
    parts.push(editorStrings.correctionHand(handLabel ? handLabel(attrs.hand) : attrs.hand));
  if (typeof attrs.seq === 'number') parts.push(editorStrings.correctionStage(attrs.seq));
  const { hand: _h, seq: _s, ...rest } = attrs;
  void _h;
  void _s;
  const other = attrsText(rest);
  if (other) parts.push(other);
  return parts.join(', ');
}

/** The rows of a tooltip about an item: label and detail. */
export function tooltipRows(
  model: Model,
  item: Item,
  handLabel?: (value: string) => string,
): [string, string][] {
  const rows: [string, string][] = [];
  if (isToken(item)) {
    for (const mark of item.marks ?? []) {
      if (mark.kind === 'variant') {
        rows.push(variantRow(mark.attrs, handLabel));
        continue;
      }
      const where =
        mark.from !== undefined && mark.to !== undefined ? ` ${mark.from}–${mark.to}` : '';
      const detail =
        mark.kind === 'del' || mark.kind === 'add'
          ? correctionText(mark.attrs, handLabel)
          : attrsText(mark.attrs);
      rows.push([`${markLabels[mark.kind] ?? mark.kind}${where}`, detail]);
    }
    if (item.norm !== undefined) {
      if (model.form === 'written') rows.push([editorStrings.readForm, item.norm]);
      else rows.push([editorStrings.writtenForm, item.form]);
    }
    if (item.unchecked) rows.push([editorStrings.unchecked, '']);
    if (item.joinNext) rows.push([editorStrings.joined, '']);
  } else if (item.kind === 'object' && item.type === 'gap' && isNotTranscribed(item.attrs)) {
    // Its reason and the words EpiDoc gives it are what the row's label already says.
    const { reason: _reason, desc, ...rest } = item.attrs ?? {};
    void _reason;
    const shown = desc === NOT_TRANSCRIBED_ATTRS.desc ? rest : { ...rest, desc };
    rows.push([editorText.gapNotTranscribed, attrsText(shown)]);
  } else if (item.kind === 'object') {
    const detail = [attrsText(item.attrs), item.text ?? ''].filter((s) => s.length).join('; ');
    rows.push([objectLabels[item.type] ?? item.type, detail || objectLabel(item)]);
  }
  return rows;
}

/**
 * The two reconfigurations that empty the undo history held in `compartment`:
 * removing the history drops its state, adding it again starts it empty.
 * Dispatched one after the other; in one transaction the state would be kept.
 */
export function resetHistory(compartment: Compartment): StateEffect<unknown>[] {
  return [compartment.reconfigure([]), compartment.reconfigure(history())];
}

/** Where the caret goes after the view changed: the start of the word it stood on, when shown, else the start. */
export function caretAfterViewChange(model: Model, caretToken: Id | null): number {
  if (!caretToken) return 0;
  return spanOf(model.ledger, caretToken)?.from ?? 0;
}

export class VariansEditor implements EditorApi {
  readonly view: EditorView;
  private whole: Stream;
  private props: Settled;
  private readonly callbacks: EditorCallbacks;
  private readonly editable = new Compartment();
  private readonly direction = new Compartment();
  private readonly numbers = new Compartment();
  private readonly undoHistory = new Compartment();
  private readonly margin = new Compartment();
  private lastSelection = '';
  private hovered: Id | null = null;
  /** The pointer's last place over the text, read once a frame. */
  private hoverAt: { x: number; y: number } | null = null;
  private hoverFrame = 0;
  private readonly ids: () => Id;
  private destroyed = false;

  constructor(
    parent: HTMLElement,
    props: EditorProps,
    callbacks: EditorCallbacks = {},
    ids: () => Id = newId,
  ) {
    this.props = settle(props);
    this.whole = props.stream;
    this.callbacks = callbacks;
    this.ids = ids;
    const model = buildModel(this.whole, this.modelOptions());
    const state = EditorState.create({
      doc: model.ledger.text,
      extensions: this.extensions(model),
    });
    this.view = new EditorView({ state, parent });
    if (Object.keys(this.props.tokenClasses).length) {
      this.view.dispatch({ effects: setTokenClasses.of(this.props.tokenClasses) });
    }
    if (this.props.marginMarks?.length) {
      this.view.dispatch({ effects: setMarginMarks.of(this.props.marginMarks) });
    }
    this.view.dom.addEventListener(SEGMENT_CLICK_EVENT, (event) => {
      const tokenId = (event as CustomEvent<Id>).detail;
      this.requestSegment(tokenId);
    });
    this.emitSelection();
  }

  /** The stream as the editor last knew it: the parent's, or the one the last edit produced. */
  get stream(): Stream {
    return this.whole;
  }

  private get model(): Model {
    return this.view.state.field(modelField).model;
  }

  private modelOptions(): ModelOptions {
    return {
      form: this.props.form,
      page: this.props.page,
      pageOrder: this.props.pageOrder,
      segmentLabels: this.props.segmentLabels,
      pageLabels: this.props.pageLabels,
    };
  }

  private extensions(model: Model): Extension {
    return [
      modelField.init(() => ({ model, ops: [] })),
      modelExtensions,
      breakPreview,
      tokenClassField,
      this.undoHistory.of(history()),
      drawSelection(),
      EditorView.lineWrapping,
      this.editable.of(editableExtension(this.props.readonly)),
      this.direction.of(directionExtension(this.props.direction)),
      this.segmentGutter(),
      marginMarksField,
      this.margin.of(this.marginExtension(this.props.marginMarks !== null)),
      this.numbers.of(this.props.lineNumbers ? this.lineNumberGutter() : []),
      hoverTooltip((view, pos, side) => this.tooltipAt(view, pos, side), { hoverTime: 250 }),
      Prec.high(keymap.of(this.keys())),
      keymap.of([...historyKeymap, ...defaultKeymap]),
      EditorView.updateListener.of((update) => this.onUpdate(update)),
      EditorView.domEventHandlers({
        cut: () => {
          const record = this.cutRecord();
          if (record) this.callbacks.oncut?.(record);
          return false;
        },
        copy: () => {
          this.callbacks.oncopy?.();
          return false;
        },
        paste: (event) => {
          if (this.props.readonly) return false;
          const text = event.clipboardData?.getData('text/plain');
          if (text && this.callbacks.onpaste?.(text)) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        dblclick: (event, view) => {
          if (!this.props.readonly || !this.callbacks.onworddblclick) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          const token = pos === null ? undefined : tokenAt(this.model.ledger, this.model.byId, pos);
          if (!token) return false;
          this.callbacks.onworddblclick(token.id);
          return true;
        },
        mousemove: (event) => {
          this.onMouseMove(event);
          return false;
        },
        mouseleave: () => {
          // A frame still to come must not light the word again.
          this.hoverAt = null;
          this.setHover(null);
          return false;
        },
      }),
      EditorView.contentAttributes.of({
        spellcheck: 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
        'aria-label': editorStrings.editor,
      }),
    ];
  }

  private segmentGutter(): Extension {
    return gutter({
      class: 'cm-segment-gutter',
      renderEmptyElements: true,
      lineMarker: (view, line) => {
        const label = lineLabel(view.state.field(modelField).model, line);
        return label ? new LabelMarker(label.label, label.tokenId, label.running) : null;
      },
      lineMarkerChange: (update) =>
        update.startState.field(modelField) !== update.state.field(modelField),
      domEventHandlers: {
        click: (view, line) => {
          this.gutterClick(line);
          return true;
        },
      },
    });
  }

  private marginExtension(shown: boolean): Extension {
    return shown ? marginGutter((key) => this.callbacks.onmarginmark?.(key)) : [];
  }

  private lineNumberGutter(): Extension {
    return lineNumbers({
      formatNumber: (n, state) => {
        const lines = linesOf(state.field(modelField).model);
        return String(lines[n - 1]?.numberInPage ?? n);
      },
    });
  }

  private keys(): KeyBinding[] {
    const bind = (key: string, run: () => boolean): KeyBinding => ({
      key,
      run,
      preventDefault: true,
    });
    return [
      { key: 'Enter', run: (view) => this.enter(view) },
      { key: 'Backspace', run: (view) => this.backspace(view) },
      { key: 'Delete', run: (view) => this.deleteForward(view) },
      bind('Mod-Shift-u', () => this.toggleMark('unclear')),
      bind('Mod-Shift-s', () => this.toggleMark('supplied')),
      bind('Mod-Shift-d', () => this.toggleMark('del')),
      bind('Mod-Shift-a', () => this.toggleMark('add')),
      bind('Mod-Shift-b', () => this.toggleMark('abbr')),
      bind('Mod-Shift-g', () => this.insertObject('gap', { reason: 'lost' })),
      bind('Mod-Shift-l', () => this.requestSegmentAtCaret()),
    ];
  }

  // Props and lifecycle

  /** Bring the editor up to date with new props. The stream is re-read only when it is not the one the last edit produced. */
  update(props: EditorProps): void {
    if (this.destroyed) return;
    const previous = this.props;
    const next = settle(props);
    this.props = next;
    const effects = [];
    if (previous.readonly !== next.readonly)
      effects.push(this.editable.reconfigure(editableExtension(next.readonly)));
    if (previous.direction !== next.direction)
      effects.push(this.direction.reconfigure(directionExtension(next.direction)));
    if (previous.lineNumbers !== next.lineNumbers) {
      effects.push(this.numbers.reconfigure(next.lineNumbers ? this.lineNumberGutter() : []));
    }
    if (previous.tokenClasses !== next.tokenClasses)
      effects.push(setTokenClasses.of(next.tokenClasses));
    if ((previous.marginMarks === null) !== (next.marginMarks === null))
      effects.push(this.margin.reconfigure(this.marginExtension(next.marginMarks !== null)));
    if (previous.marginMarks !== next.marginMarks)
      effects.push(setMarginMarks.of(next.marginMarks ?? []));
    if (effects.length) this.view.dispatch({ effects });
    const streamChanged = next.stream !== this.whole;
    const modelChanged =
      streamChanged ||
      next.form !== previous.form ||
      next.page !== previous.page ||
      next.pageOrder !== previous.pageOrder ||
      next.segmentLabels !== previous.segmentLabels ||
      next.pageLabels !== previous.pageLabels;
    if (streamChanged) this.whole = next.stream;
    const viewChanged = next.form !== previous.form || next.page !== previous.page;
    const caret = viewChanged ? this.tokenAtCaret() : null;
    if (modelChanged) this.resync();
    if (viewChanged) this.settleView(caret);
  }

  /**
   * After the page or the form shown changed: the undo history of the text
   * that was shown is dropped (its positions mean nothing in the new text,
   * and an undo would edit other words, or the other form), and the caret
   * goes to the word it stood on when that word is shown, else to the start.
   */
  private settleView(caretToken: Id | null): void {
    for (const effects of resetHistory(this.undoHistory)) this.view.dispatch({ effects });
    const anchor = caretAfterViewChange(this.model, caretToken);
    this.view.dispatch({ selection: { anchor }, scrollIntoView: anchor > 0 });
  }

  destroy(): void {
    this.destroyed = true;
    if (this.hoverFrame) cancelAnimationFrame(this.hoverFrame);
    this.view.destroy();
  }

  /**
   * Rebuild the model from the whole stream. Where the document's words
   * already match, only the model changes; otherwise the text is replaced
   * by the smallest change, the selection mapped through it, outside the
   * undo history.
   */
  private resync(): void {
    const doc = this.view.state.doc.toString();
    const aligned = buildModel(this.whole, this.modelOptions(), doc);
    if (!aligned.misaligned) {
      this.view.dispatch({ effects: setModel.of(aligned) });
      return;
    }
    const canonical = buildModel(this.whole, this.modelOptions());
    const change = minimalChange(doc, canonical.ledger.text);
    this.view.dispatch({
      changes: change ?? undefined,
      effects: setModel.of(canonical),
      annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)],
    });
  }

  // Updates

  private onUpdate(update: ViewUpdate): void {
    let modelChanged = false;
    let rebuild = false;
    for (const tr of update.transactions) {
      const before = tr.startState.field(modelField, false);
      const after = tr.state.field(modelField, false);
      if (!before || !after || before === after) continue;
      modelChanged = true;
      if (after.ops.length) this.emit(after.ops);
      if (after.whole?.length) {
        this.emit(after.whole);
        rebuild = true;
      }
    }
    if (rebuild || update.state.field(modelField).model.misaligned) this.resync();
    if (update.selectionSet || update.docChanged || modelChanged) this.emitSelection();
  }

  private emit(ops: Op[]): void {
    try {
      this.whole = applyOps(this.whole, ops).stream;
    } catch (error) {
      console.error('[editor] operations do not apply to the stream; the text is reset', error);
      this.resync();
      return;
    }
    this.callbacks.onops?.(ops, this.whole);
  }

  private emitSelection(): void {
    const main = this.view.state.selection.main;
    const { tokenIds, caret } = selectionTokens(this.model.ledger, main.from, main.to, main.head);
    const key = `${tokenIds.join(',')}|${caret ?? ''}`;
    if (key === this.lastSelection) return;
    this.lastSelection = key;
    this.callbacks.onselection?.(tokenIds, caret);
  }

  // Keys

  private enter(view: EditorView): boolean {
    if (this.props.readonly) return true;
    const main = view.state.selection.main;
    if (main.empty) {
      const model = this.model;
      const edit = hyphenEnter(model.ledger, model.byId, main.head);
      if (edit) {
        view.dispatch({
          changes: { from: edit.from, to: edit.to, insert: '\n' },
          selection: { anchor: edit.from + 1 },
          annotations: editIntent.of({ join: edit.tokenId }),
          userEvent: 'input',
          scrollIntoView: true,
        });
        return true;
      }
    }
    return insertNewline(view);
  }

  private backspace(view: EditorView): boolean {
    if (this.props.readonly) return true;
    const main = view.state.selection.main;
    if (main.empty) {
      const model = this.model;
      const edit = backspaceUnjoin(model.ledger, model.byId, main.head);
      if (edit) {
        view.dispatch({
          changes: { from: edit.from, to: edit.to },
          selection: { anchor: edit.from },
          annotations: editIntent.of({ unjoin: edit.tokenId }),
          userEvent: 'delete.backward',
          scrollIntoView: true,
        });
        return true;
      }
    }
    if (main.empty) {
      const join = joinLinesEdit(this.model.ledger, this.model.byId, main.head, 'backward');
      if (join) {
        view.dispatch({
          changes: join,
          selection: { anchor: join.from + join.insert.length },
          userEvent: 'delete.backward',
          scrollIntoView: true,
        });
        return true;
      }
    }
    return deleteCharBackward(view);
  }

  /** Delete at the end of a line before a word: the lines join with the words kept apart. */
  private deleteForward(view: EditorView): boolean {
    if (this.props.readonly) return true;
    const main = view.state.selection.main;
    if (!main.empty) return false;
    const join = joinLinesEdit(this.model.ledger, this.model.byId, main.head, 'forward');
    if (!join) return false;
    view.dispatch({
      changes: join,
      selection: { anchor: join.from },
      userEvent: 'delete.forward',
      scrollIntoView: true,
    });
    return true;
  }

  // Hover and tooltips

  /** The word under the pointer, found once a frame while it moves, so the image follows at once. */
  private onMouseMove(event: MouseEvent): void {
    if (!this.callbacks.ontokenhover) return;
    this.hoverAt = { x: event.clientX, y: event.clientY };
    if (this.hoverFrame) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      const at = this.hoverAt;
      if (at && !this.destroyed) this.setHover(this.tokenAtCoords(at.x, at.y));
    });
  }

  private tokenAtCoords(x: number, y: number): Id | null {
    const pos = this.view.posAtCoords({ x, y }, false);
    const span = tokenSpanAt(this.model.ledger, pos);
    if (!span || span.to <= span.from) return null;
    const first = this.view.coordsForChar(span.from);
    const last = this.view.coordsForChar(span.to - 1);
    if (!first || !last) return null;
    const onLine = (y >= first.top && y <= first.bottom) || (y >= last.top && y <= last.bottom);
    const left = Math.min(first.left, last.left);
    const right = Math.max(first.right, last.right);
    return onLine && x >= left - 2 && x <= right + 2 ? span.id : null;
  }

  private setHover(id: Id | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.callbacks.ontokenhover?.(id);
  }

  private tooltipAt(view: EditorView, pos: number, side: -1 | 1): Tooltip | null {
    const model = view.state.field(modelField).model;
    const span = spanContaining(model.ledger, side < 0 ? pos - 1 : pos);
    if (!span || span.kind === 'break') return null;
    const item = model.byId.get(span.id);
    if (!item) return null;
    const rows = tooltipRows(model, item, this.props.handLabel);
    if (!rows.length) return null;
    return {
      pos: span.from,
      end: span.to,
      above: true,
      create() {
        const dom = document.createElement('div');
        dom.className = 'cm-varians-tooltip';
        for (const [label, detail] of rows) {
          const row = document.createElement('div');
          row.className = 'cm-varians-tooltip-row';
          const name = document.createElement('span');
          name.className = 'cm-varians-tooltip-label';
          name.textContent = label;
          row.appendChild(name);
          if (detail) {
            const value = document.createElement('span');
            value.className = 'cm-varians-tooltip-detail';
            value.textContent = detail;
            row.appendChild(value);
          }
          dom.appendChild(row);
        }
        return { dom };
      },
    };
  }

  // Segments

  private gutterClick(line: BlockInfo): void {
    const model = this.model;
    const label = lineLabel(model, line);
    if (label) {
      this.requestSegment(label.tokenId);
      return;
    }
    const info = lineAt(linesOf(model), line.from);
    if (info?.first) this.requestSegment(info.first.id);
  }

  private requestSegment(tokenId: Id): boolean {
    const model = this.model;
    const item = model.byId.get(tokenId);
    if (!item || item.kind === 'break') return false;
    const current = item.segment ? segmentLabel(model, item.segment) : null;
    this.callbacks.onrequestsegment?.(tokenId, current);
    return true;
  }

  // Edits made by commands

  private targets(): MarkTarget[] {
    const model = this.model;
    const main = this.view.state.selection.main;
    return markTargets(model.ledger, model.byId, model.form, main.from, main.to);
  }

  /** Dispatch operations on the shown items, with the text change that shows them when there is one. */
  private edit(
    ops: Op[],
    change?: { from: number; to: number; insert: string },
    caret?: number,
  ): boolean {
    if (this.props.readonly || ops.length === 0) return false;
    let reverse: Op[];
    try {
      reverse = applyOps(this.model.view.stream, ops).reverse;
    } catch (error) {
      console.error('[editor] the edit does not apply', error);
      return false;
    }
    this.view.dispatch({
      changes: change,
      selection: caret === undefined ? undefined : { anchor: caret },
      effects: modelEdit.of({ ops, reverse }),
      userEvent: 'input',
      scrollIntoView: true,
    });
    return true;
  }

  applyMark(kind: string, attrs?: MarkAttrs): boolean {
    return this.edit(addMarkOps(this.model.byId, this.targets(), kind, attrs));
  }

  removeMark(kind: string): boolean {
    return this.edit(removeMarkOps(this.model.byId, this.targets(), kind));
  }

  hasMark(kind: string): boolean {
    const model = this.model;
    const targets = this.targets();
    if (!targets.length) return false;
    return targets.every((target) => {
      const marks = marksOfKind(model.byId.get(target.tokenId), kind);
      if (target.from === undefined || target.to === undefined) return marks.length > 0;
      return marks.some(
        (m) =>
          m.from === undefined || ((m.from ?? 0) < target.to! && (m.to ?? Infinity) > target.from!),
      );
    });
  }

  toggleMark(kind: string, attrs?: MarkAttrs): boolean {
    return this.hasMark(kind) ? this.removeMark(kind) : this.applyMark(kind, attrs);
  }

  variantAtSelection(): (VariantFound & { exact: boolean }) | null {
    const byId = this.model.byId;
    const targets = this.targets();
    const exact = variantSpanned(byId, targets);
    if (exact) return { ...exact, exact: true };
    const first = variantsIn(byId, targets)[0];
    return first ? { ...first, exact: false } : null;
  }

  setVariant(variant: VariantAttrs): boolean {
    // A short id: it only has to tell the variants of one transcription apart.
    return this.edit(
      setVariantOps(this.model.byId, this.targets(), variant, () => this.ids().slice(-8)),
    );
  }

  removeVariant(): boolean {
    return this.edit(removeVariantOps(this.model.byId, this.targets()));
  }

  correctionAtSelection(): CorrectionFound | null {
    return correctionIn(this.model.byId, this.targets());
  }

  setCorrection(attrs: CorrectionAttrs): boolean {
    return this.edit(setCorrectionOps(this.model.byId, this.targets(), attrs));
  }

  insertObject(type: ObjectType, attrs?: MarkAttrs, text?: string): boolean {
    if (this.props.readonly) return false;
    const model = this.model;
    const plan = planInsertion(
      model.ledger,
      model.byId,
      model.form,
      this.view.state.selection.main.head,
      'object',
    );
    const obj: Obj = { kind: 'object', id: this.ids(), type };
    if (attrs && Object.keys(attrs).length) obj.attrs = attrs;
    if (text) obj.text = text;
    const ops: Op[] = [];
    if (plan.split)
      ops.push({ t: 'split', id: plan.split.id, at: plan.split.at, newId: this.ids() });
    ops.push({ t: 'insert', after: plan.after, items: [obj] });
    return this.edit(ops, plan.change, plan.caret);
  }

  insertBreak(type: BreakType): boolean {
    if (this.props.readonly) return false;
    const model = this.model;
    const at = breakAt(model, this.view.state.selection.main.head, type);
    if (!at || at.target.t === 'none') return false;
    if (at.target.t === 'set') {
      // The break before the line takes the new type: it ends the line above as well.
      const fields: Record<string, unknown> = { type };
      if (at.opener?.label && at.opener.type !== type) fields.label = null;
      return this.edit([{ t: 'set', id: at.target.id, fields }]);
    }
    const plan = planInsertion(model.ledger, model.byId, model.form, at.line.from, 'break');
    const brk: Break = { kind: 'break', id: this.ids(), type };
    return this.edit([{ t: 'insert', after: plan.after, items: [brk] }], plan.change, plan.caret);
  }

  breakChoices(): BreakChoices | null {
    if (this.props.readonly) return null;
    const model = this.model;
    const head = this.view.state.selection.main.head;
    const column = breakAt(model, head, 'column');
    const paragraph = breakAt(model, head, 'paragraph');
    if (!column || !paragraph) return null;
    return {
      line: column.line.numberInPage,
      column: column.target,
      paragraph: paragraph.target,
    };
  }

  previewBreak(preview: BreakPreview): void {
    if (this.destroyed) return;
    this.view.dispatch({ effects: setBreakPreview.of(preview) });
  }

  setJoinAtCaret(): boolean {
    const model = this.model;
    const head = this.view.state.selection.main.head;
    const line = lineAt(linesOf(model), head);
    if (!line) return false;
    let token: Token | undefined;
    for (const span of model.ledger.spans) {
      if (span.from > line.to) break;
      if (span.kind !== 'token' || span.from < line.from) continue;
      const item = model.byId.get(span.id);
      if (isToken(item)) token = item;
    }
    if (!token) return false;
    return this.edit([setJoin(token, !token.joinNext)]);
  }

  requestSegmentAtCaret(): boolean {
    const model = this.model;
    const head = this.view.state.selection.main.head;
    const token = tokenAt(model.ledger, model.byId, head);
    if (token) return this.requestSegment(token.id);
    const line = lineAt(linesOf(model), head);
    return line?.first ? this.requestSegment(line.first.id) : false;
  }

  // Navigation

  scrollToToken(id: Id): void {
    const span = spanOf(this.model.ledger, id);
    if (!span) return;
    this.view.dispatch({ effects: EditorView.scrollIntoView(span.from, { y: 'center' }) });
  }

  placeCaret(id: Id): void {
    const span = spanOf(this.model.ledger, id);
    if (!span) return;
    this.view.dispatch({ selection: EditorSelection.cursor(span.from), scrollIntoView: true });
  }

  selectToken(id: Id): void {
    const span = spanOf(this.model.ledger, id);
    if (!span) return;
    this.view.dispatch({
      selection: EditorSelection.single(span.from, span.to),
      scrollIntoView: true,
    });
  }

  selectTokens(fromId: Id, toId: Id): void {
    const from = spanOf(this.model.ledger, fromId);
    const to = spanOf(this.model.ledger, toId);
    if (!from || !to) return;
    const start = Math.min(from.from, to.from);
    const end = Math.max(from.to, to.to);
    this.view.dispatch({ selection: EditorSelection.single(start, end), scrollIntoView: true });
  }

  clearSelection(): void {
    const main = this.view.state.selection.main;
    if (!main.empty) this.view.dispatch({ selection: EditorSelection.cursor(main.head) });
  }

  selectionRect(): { top: number; bottom: number; left: number; right: number } | null {
    const range = this.view.state.selection.main;
    if (range.empty) return null;
    const start = this.view.coordsAtPos(range.from, 1);
    const end = this.view.coordsAtPos(range.to, -1);
    if (!start || !end) return null;
    return {
      top: Math.min(start.top, end.top),
      bottom: Math.max(start.bottom, end.bottom),
      left: Math.min(start.left, end.left),
      right: Math.max(start.right, end.right),
    };
  }

  focus(): void {
    this.view.focus();
  }

  applyWhole(ops: Op[]): boolean {
    if (this.props.readonly || ops.length === 0 || this.destroyed) return false;
    let applied: ReturnType<typeof applyOps>;
    try {
      applied = applyOps(this.whole, ops);
    } catch (error) {
      console.error('[editor] the operations do not apply to the stream', error);
      return false;
    }
    const canonical = buildModel(applied.stream, this.modelOptions());
    const change = minimalChange(this.view.state.doc.toString(), canonical.ledger.text);
    this.view.dispatch({
      changes: change ?? undefined,
      effects: wholeEdit.of({ ops, reverse: applied.reverse }),
      annotations: [Transaction.userEvent.of('move'), isolateHistory.of('full')],
    });
    return true;
  }

  caretPlace(): { after: Id | null } | { page: string } | null {
    if (this.props.readonly) return null;
    const model = this.model;
    if (model.misaligned) return null;
    if (model.view.missing) return { page: model.view.missing.pageId };
    const pos = this.view.state.selection.main.head;
    let after: Id | null = model.view.anchor ? model.view.anchor.id : null;
    for (const span of model.ledger.spans) {
      if (span.to <= pos) after = span.id;
      else {
        // Inside a word: after the whole word.
        if (span.from < pos && span.kind === 'token') after = span.id;
        break;
      }
    }
    return { after };
  }

  /** What a cut of the selection would take. */
  private cutRecord(): CutRecord | null {
    const main = this.view.state.selection.main;
    if (main.empty) return null;
    const model = this.model;
    const spans = model.ledger.spans.filter((s) => s.from < main.to && s.to > main.from);
    const items = spans
      .map((s) => model.byId.get(s.id))
      .filter((item): item is Item => item !== undefined);
    if (items.length === 0) return null;
    const whole = spans.every((s) => s.from >= main.from && s.to <= main.to);
    return {
      items: structuredClone(items),
      text: this.view.state.sliceDoc(main.from, main.to),
      whole,
    };
  }

  tokenAtCaret(): Id | null {
    const model = this.model;
    return tokenAt(model.ledger, model.byId, this.view.state.selection.main.head)?.id ?? null;
  }

  selectedTokens(): Id[] {
    const main = this.view.state.selection.main;
    return selectionTokens(this.model.ledger, main.from, main.to, main.head).tokenIds;
  }

  undo(): boolean {
    return undoCommand(this.view);
  }

  redo(): boolean {
    return redoCommand(this.view);
  }
}
