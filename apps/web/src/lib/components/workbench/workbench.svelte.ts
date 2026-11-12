/**
 * The workbench's state on the client: the stream and its save session, the
 * view (form, page, selection), the segment labels, the normalization memory
 * and the zones of the pages seen. Components read it and call its methods;
 * the editor reports through `editorOps` and `editorSelection`.
 */

import { untrack } from 'svelte';
import type { WitnessHand } from '@varians/db';
import {
  applyOps,
  insertIntoPage,
  moveToPage,
  repairSegmentStartsFrom,
  segmentAt,
  type Item,
  type SegmentStart,
  type Unit,
  segmentUnits,
  segmentRuns,
  isBreak,
  isToken,
  NormalizationMemory,
  proposeNorms,
  type Id,
  type Level,
  type MemoryEntry,
  type NormalizationProfile,
  type Op,
  type Scheme,
  type Stream,
  type Token,
  type ZoneGeometry,
} from '@varians/core';
import { DEFAULT_MAX_UPLOAD_BYTES } from '$lib/components/pages/files';
import type { ImageDefaults, PageView, WitnessPagesData } from '$lib/components/pages/types';
import type { CutRecord, EditorApi } from '$lib/editor/editor';
import { pageView } from '$lib/editor/page';
import {
  caseOps,
  nextWord,
  normalizeWord,
  removeMarksOps,
  setTextOp,
  takeForms,
  textOf,
  type AnalysisLike,
  type FormField,
  type FormOption,
  type MarkKind,
} from '$lib/workbench/diacritics';
import { DocumentSession, fetchTransport } from '$lib/editor/session';
import type { FacsimileSource } from '$lib/facsimile/types';
import { unmappedTokens, type ZoneLike } from '$lib/workbench/mapping';
import {
  autoConfirmOps,
  confirmTokens,
  distinctPairs,
  profilesByWork,
  typedReadForms,
  uncheckedIn,
  type FormPair,
} from '$lib/workbench/normalization';
import {
  hasUnplacedText,
  initialView,
  neighbours,
  nextPageWithoutText,
  pageOf,
  pagesWithText,
  settleView,
  UNPLACED,
  viewOrder,
  WHOLE,
  wordsUnplaced,
  type WitnessPage,
} from '$lib/workbench/pages';
import type { SegmentInfo } from '$lib/workbench/segments';
import { lineCount } from '$lib/workbench/view';
import { workbench as t } from '$lib/strings/workbench';

export interface WorkbenchPage extends WitnessPage {
  width: number | null;
  height: number | null;
  source: FacsimileSource | null;
  /** An image to read lines from: the uploaded file, or a IIIF image service. */
  image: { kind: 'file' | 'iiif'; url: string } | null;
  /** The image's rights statement and credit line, shown under it. */
  rights?: string | null;
  attribution?: string | null;
}

export interface WorkbenchWork {
  id: string;
  slug: string;
  title: string;
  language: string;
  levels: Level[];
  profile: NormalizationProfile;
}

export interface WorkbenchInput {
  transcription: {
    id: string;
    name: string;
    version: number;
    content: Stream;
    keepsWrittenForm: boolean;
    displayAsWritten: boolean;
    memory: MemoryEntry[];
    visibility: string;
    sources: string | null;
    rightsNote: string | null;
    licence?: string | null;
    installationLicence?: string;
    workIds: string[];
    profile: Partial<NormalizationProfile> | null;
  };
  witness: {
    id: string;
    slug: string;
    siglum: string;
    name: string;
    hands: WitnessHand[];
    imageDefaults?: ImageDefaults;
  };
  pages: WorkbenchPage[];
  works: WorkbenchWork[];
  segments: Record<string, SegmentInfo>;
  canEdit: boolean;
  canDelete: boolean;
  canMaintainWitness: boolean;
  /** The largest image file the server takes for a page. */
  maxUploadBytes?: number;
}

export interface Zone extends ZoneLike {
  pageId: string;
  geometry: ZoneGeometry;
}

export type Form = 'written' | 'read';

/** How long after the last keystroke the workbench does its own follow-up (memory, check marks). */
const IDLE_MS = 1500;

/** Where the browser remembers the view last shown of a transcript (C2). */
export const viewKey = (id: string) => `varians.workbench.view.${id}`;

/** What a cut took, kept so that pasting it again moves the words instead of making new ones (C6). */
interface CutWords {
  items: Item[];
  text: string;
  /** The segment the first word belonged to by flow, which a start of its own may not say. */
  firstSegment: SegmentStart | null;
  /** The page the words stood on. */
  page: string | null;
}

/** A passing message of the status line, with the view it can show. */
export interface WorkbenchNotice {
  text: string;
  view: string | null;
}

const sameText = (a: string, b: string) =>
  a.replace(/\r\n?/gu, '\n') === b.replace(/\r\n?/gu, '\n');

export class Workbench {
  readonly id: string;
  readonly witness: WorkbenchInput['witness'];
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  readonly canMaintainWitness: boolean;
  readonly maxUploadBytes: number;
  readonly visibility: string;
  /** The works the transcription is for, in order: the first gives the defaults (segment labels, spelling rules for text not yet assigned). */
  readonly workIds: string[];
  /** The first of them, else the first work its text is assigned to. */
  readonly workId: string | null;
  readonly profileOverrides: Partial<NormalizationProfile> | null;

  // What the server knows
  name = $state('');
  /** What the transcription rests on, and its rightsNote, as its maker states them. */
  sources = $state<string | null>(null);
  rightsNote = $state<string | null>(null);
  /** The licence fixed at publication, and the installation's. */
  licence = $state<string | null>(null);
  installationLicence = $state('');
  keepsWrittenForm = $state(false);
  displayAsWritten = $state(false);
  pages = $state.raw<WorkbenchPage[]>([]);
  /** The pages as the Pages tab shows them, with thumbnails and what refers to them; loaded when the tab asks. */
  pageViews = $state.raw<PageView[] | null>(null);
  /** The rights statement and credit line new images of the witness are given. */
  imageDefaults = $state.raw<ImageDefaults>({ rights: null, attribution: null });
  works = $state.raw<WorkbenchWork[]>([]);
  segments = $state.raw<Record<string, SegmentInfo>>({});

  // The document
  stream = $state.raw<Stream>({ items: [] });
  version = $state(0);
  pending = $state(0);
  saving = $state(false);
  saveError = $state<string | null>(null);
  /** Local changes set aside at the last conflict. */
  setAside = $state.raw<Op[] | null>(null);
  /**
   * Counts the times the whole document was replaced from the server (an
   * import, a revert in the history): the editor is made anew then, so that
   * its undo history, which belongs to the old text, goes with it.
   */
  generation = $state(0);

  // The view
  form = $state<Form>('read');
  /** The view asked for: `'unplaced'`, a page id, or `'whole'`. */
  requestedView = $state<string | null>(null);
  /** In Staging: the page the facsimile shows, chosen in its own chooser; null for the proposed page. */
  facsimileChoice = $state<string | null>(null);
  /** A passing message of the status line. */
  notice = $state.raw<WorkbenchNotice | null>(null);
  selection = $state.raw<{ ids: Id[]; caret: Id | null }>({ ids: [], caret: null });
  api = $state.raw<EditorApi | null>(null);
  hoveredToken = $state<Id | null>(null);
  /** Text is selected in the editor (not only a caret in a word). */
  hasRange = $state(false);
  /** Tokens lit from outside the text: the words of a zone under the pointer. */
  litTokens = $state.raw<Id[]>([]);
  /** Light the words of the page that have no zone. */
  showUnmapped = $state(false);
  /** The selection toolbar asked to map the selected words: the facsimile takes the request once. */
  mapRequested = $state(false);

  // Zones of the pages seen, by page id
  zones = $state.raw<Record<string, Zone[]>>({});

  // Normalization memory, with a counter so that what reads it is recomputed
  private memory: NormalizationMemory;
  private memoryTick = $state(0);
  private memoryQueue: Promise<void> = Promise.resolve();

  private session: DocumentSession | null = null;
  private typed = new Map<Id, FormPair>();
  private typedTimer: ReturnType<typeof setTimeout> | null = null;
  private recheck = new Set<Id>();
  private zoneLoads = new Map<string, Promise<void>>();
  /** The labels of every page seen, so that a page removed meanwhile still has its label while the text catches up. */
  private seenLabels = $state.raw<Record<string, string>>({});
  private cutWords: CutWords | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(input: WorkbenchInput) {
    this.id = input.transcription.id;
    this.witness = input.witness;
    this.canEdit = input.canEdit;
    this.canDelete = input.canDelete;
    this.canMaintainWitness = input.canMaintainWitness;
    this.maxUploadBytes = input.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
    this.visibility = input.transcription.visibility;
    this.workIds = input.transcription.workIds;
    this.workId = input.transcription.workIds[0] ?? input.works[0]?.id ?? null;
    this.profileOverrides = input.transcription.profile;
    this.sources = input.transcription.sources;
    this.rightsNote = input.transcription.rightsNote;
    this.licence = input.transcription.licence ?? null;
    this.installationLicence = input.transcription.installationLicence ?? '';
    this.name = input.transcription.name;
    this.keepsWrittenForm = input.transcription.keepsWrittenForm;
    this.displayAsWritten = input.transcription.displayAsWritten;
    this.pages = input.pages;
    this.imageDefaults = input.witness.imageDefaults ?? { rights: null, attribution: null };
    this.works = input.works;
    this.segments = input.segments;
    this.stream = input.transcription.content;
    this.version = input.transcription.version;
    this.memory = new NormalizationMemory(input.transcription.memory);
    this.form = input.transcription.keepsWrittenForm ? 'written' : 'read';
    this.requestedView = initialView(this.stream, this.pages);
  }

  /** The view last shown of this transcript in this browser, when it still exists (C2). */
  restoreView(): void {
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(viewKey(this.id));
    } catch {
      return;
    }
    if (!remembered || settleView(remembered, this.stream, this.pages) !== remembered) return;
    // Staging left empty since, while pages have text: the text has been placed, and the transcript opens where it is.
    if (
      remembered === UNPLACED &&
      !hasUnplacedText(this.stream) &&
      pagesWithText(this.stream).size > 0
    )
      return;
    this.requestedView = remembered;
  }

  /** Remember the view shown, for the next opening; a witness without pages has only its text to show. */
  rememberView(): void {
    if (this.pages.length === 0) return;
    try {
      localStorage.setItem(viewKey(this.id), this.view);
    } catch {
      // The browser keeps nothing; the next opening starts from the text.
    }
  }

  // Derived

  readonly pageLabels = $derived({
    ...this.seenLabels,
    ...Object.fromEntries(this.pages.map((p) => [p.id, p.label])),
  });
  readonly pageOrder = $derived(this.pages.map((p) => p.id));
  readonly segmentLabels = $derived(
    Object.fromEntries(Object.entries(this.segments).map(([id, s]) => [id, s.label])),
  );
  /** The pages of the witness with text in this transcript, with their words and lines. */
  readonly textOnPages = $derived(pagesWithText(this.stream));
  /** Words on no page. */
  readonly unplacedWords = $derived(wordsUnplaced(this.stream));
  /** The view shown: the requested one when it is still valid. */
  readonly view = $derived(settleView(this.requestedView, this.stream, this.pages));
  /** What the editor shows: a page id, `'unplaced'`, or null for the whole text. */
  readonly page = $derived(this.view === WHOLE ? null : this.view);
  /** Words can be mapped to the image in a page's own view only. */
  readonly onPage = $derived(this.view !== WHOLE && this.view !== UNPLACED);
  /**
   * The page Move to Page… proposes (C5): in Staging, the page the
   * facsimile shows (chosen, else the first page without text); on a page,
   * the first other page without text.
   */
  readonly proposedPage = $derived.by(() => {
    if (this.view === WHOLE) return null;
    if (this.view === UNPLACED) {
      const chosen = this.facsimileChoice;
      if (chosen && this.pages.some((p) => p.id === chosen)) return chosen;
      return nextPageWithoutText(this.pages, this.stream) ?? this.pages[0]?.id ?? null;
    }
    return this.pages.find((p) => p.id !== this.view && !this.textOnPages.has(p.id))?.id ?? null;
  });
  /** The witness page the facsimile shows: the page shown, in Staging the proposed one, in the whole text the caret's. */
  readonly pageId = $derived.by(() => {
    if (this.view === UNPLACED) return this.proposedPage;
    if (this.view === WHOLE) {
      const caret = this.selection.caret;
      const at = caret ? pageOf(this.stream, caret) : null;
      return at && at !== UNPLACED ? at : null;
    }
    return this.view;
  });
  readonly witnessPage = $derived(this.pages.find((p) => p.id === this.pageId) ?? null);
  readonly pageLabel = $derived(
    this.view === WHOLE
      ? t.pages.whole
      : this.view === UNPLACED
        ? t.pages.unplaced
        : (this.pages.find((p) => p.id === this.view)?.label ?? ''),
  );
  readonly pageStream = $derived(pageView(this.stream, this.page, this.pageOrder).stream);
  /** The text of the page the facsimile shows. */
  readonly facsimileStream = $derived(
    this.onPage
      ? this.pageStream
      : this.pageId
        ? pageView(this.stream, this.pageId, this.pageOrder).stream
        : { items: [] },
  );
  readonly neighbours = $derived(neighbours(this.view, viewOrder(this.pages)));
  readonly editorForm = $derived<Form>(this.keepsWrittenForm ? this.form : 'written');
  readonly otherForm = $derived<Form>(this.editorForm === 'written' ? 'read' : 'written');
  readonly lines = $derived(lineCount(this.pageStream));
  /** The spelling rules each word is read by: its stretch's work's, else the first work's. */
  readonly profile = $derived.by(() =>
    profilesByWork(this.stream, this.segments, this.works, this.profileOverrides, this.workId),
  );
  readonly unchecked = $derived(this.keepsWrittenForm ? uncheckedIn(this.pageStream).length : 0);
  readonly proposals = $derived.by(() => {
    void this.memoryTick;
    return this.keepsWrittenForm ? proposeNorms(this.pageStream, this.profile, this.memory) : [];
  });
  readonly pageZones = $derived(this.pageId ? (this.zones[this.pageId] ?? null) : null);
  readonly unmapped = $derived(
    this.pageZones && this.witnessPage?.source
      ? unmappedTokens(this.facsimileStream, this.pageZones)
      : [],
  );
  readonly schemes = $derived(
    new Map(this.works.map((w) => [w.id, { levels: w.levels } satisfies Scheme])),
  );

  /** Words selected in the editor, or the word at the caret. */
  readonly focusTokens = $derived(
    this.selection.ids.length
      ? this.selection.ids
      : this.selection.caret
        ? [this.selection.caret]
        : [],
  );

  schemeOf = (workId: string): Scheme | undefined => this.schemes.get(workId);

  /** Proposals over the whole text, for accepting a pair everywhere at once. */
  proposalsEverywhere() {
    void this.memoryTick;
    return proposeNorms(this.stream, this.profile, this.memory);
  }

  // Saving

  /** Start saving; only for those who may edit, and only in the browser. */
  start(): void {
    if (!this.canEdit || this.session) return;
    // A session replaced (after an import, a revert) may still finish a request: it speaks no more.
    const current = () => this.session === session;
    const session: DocumentSession = new DocumentSession(
      { content: this.stream, version: this.version },
      fetchTransport(`/api/documents/transcription/${this.id}/ops`),
      {
        onChange: (state) => {
          if (!current()) return;
          this.version = state.version;
          this.pending = state.pending;
          this.saving = state.saving;
          this.saveError = state.error;
        },
        onConflict: ({ dropped }) => {
          if (!current()) return;
          this.setAside = dropped.length ? dropped : null;
          // What was changed elsewhere may be the witness's pages.
          void this.refreshPages();
        },
        // The server put the pages back in shape after a save: a page was removed or moved meanwhile.
        onAdjusted: ({ dropped, stream }) => {
          if (!current()) return;
          if (dropped.length) this.setAside = dropped;
          if (wordsUnplaced(stream) > this.unplacedWords) this.say(t.pages.pageGone, UNPLACED);
          else this.say(t.pages.reorganized);
          void this.refreshPages();
        },
        onExternalContent: (stream) => {
          if (current()) this.stream = stream;
        },
      },
    );
    this.session = session;
  }

  stop(): void {
    this.flushTyped();
    this.session?.close();
    this.session = null;
    if (this.typedTimer) clearTimeout(this.typedTimer);
  }

  get unsaved(): boolean {
    return this.pending > 0 || this.saving;
  }

  async flush(): Promise<void> {
    this.flushTyped();
    await this.session?.flush();
  }

  /** Try a failed save again. */
  retry(): void {
    void this.session?.flush();
  }

  /** Take a document the server holds now (after an import, a revert in the history, a settings change). */
  replaceDocument(doc: { version: number; content: Stream }): void {
    this.session?.close();
    this.session = null;
    this.stream = doc.content;
    this.version = doc.version;
    this.pending = 0;
    this.saving = false;
    this.saveError = null;
    this.generation++;
    this.start();
  }

  /** Read the document again from the server, after saving what is pending. */
  async reload(): Promise<void> {
    await this.flush();
    const response = await fetch(`/api/documents/transcription/${this.id}/ops`);
    if (!response.ok) return;
    const doc = (await response.json()) as { version: number; content: Stream };
    // Edits made meanwhile go out against the old version and merge at the conflict.
    if ((this.session?.state.pending ?? 0) > 0) return;
    this.replaceDocument(doc);
  }

  // Edits

  /** Operations the workbench makes itself (segments, read forms, page breaks): applied to the stream and saved. */
  apply(ops: Op[]): boolean {
    if (!this.canEdit || ops.length === 0) return false;
    let next: Stream;
    try {
      next = applyOps(this.stream, ops).stream;
    } catch (error) {
      console.error('[workbench] the operations do not apply', error);
      return false;
    }
    this.stream = next;
    this.session?.apply(ops, next);
    return true;
  }

  /** The editor made an edit: `next` is the stream after it. */
  editorOps(ops: Op[], next: Stream): void {
    this.stream = next;
    this.session?.apply(ops, next);
    if (!this.canEdit) return;
    // Read forms typed in the read view are remembered once the word is left.
    if (this.keepsWrittenForm && this.editorForm === 'read') {
      for (const { tokenId, pair } of typedReadForms(ops, next)) {
        if (pair) this.typed.set(tokenId, pair);
        else this.typed.delete(tokenId);
      }
    }
    // A written form changed under a read form it still folds to is confirmed by itself.
    if (this.keepsWrittenForm) {
      for (const op of ops) if (op.t === 'set' && 'form' in op.fields) this.recheck.add(op.id);
    }
    this.scheduleIdle();
  }

  editorSelection(ids: Id[], caret: Id | null): void {
    const before = this.selection.caret;
    this.selection = { ids, caret };
    if (before && before !== caret && this.typed.has(before)) this.flushTyped([before]);
  }

  private scheduleIdle(): void {
    if (this.typedTimer) clearTimeout(this.typedTimer);
    this.typedTimer = setTimeout(() => {
      this.typedTimer = null;
      this.flushTyped();
      this.confirmAgreeing();
    }, IDLE_MS);
  }

  /** Remember the read forms typed for these tokens (all pending ones when omitted). */
  private flushTyped(ids?: Id[]): void {
    const pairs: FormPair[] = [];
    for (const id of ids ?? [...this.typed.keys()]) {
      const pair = this.typed.get(id);
      this.typed.delete(id);
      if (pair) pairs.push(pair);
    }
    if (pairs.length) this.remember(pairs);
  }

  private confirmAgreeing(): void {
    if (this.recheck.size === 0) return;
    const ids = [...this.recheck];
    this.recheck.clear();
    this.apply(autoConfirmOps(this.stream, ids, this.profile));
  }

  // Normalization

  /** Remember written-to-read pairs, here and on the server, one request after the other. */
  remember(pairs: FormPair[]): void {
    const distinct = distinctPairs(pairs);
    if (distinct.length === 0 || !this.canEdit) return;
    for (const pair of distinct) {
      this.memory.remember(pair.form, pair.norm);
      this.memoryQueue = this.memoryQueue
        .then(async () => {
          await fetch(`/api/transcriptions/${this.id}/memory`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(pair),
          });
        })
        .catch(() => undefined);
    }
    this.memoryTick++;
  }

  /** Confirm the read forms of the selected (or caret) words as they stand. */
  confirm(ids: Id[] = this.focusTokens): number {
    const { ops, pairs } = confirmTokens(this.stream, ids);
    if (!this.apply(ops)) return 0;
    this.remember(pairs);
    return ops.length;
  }

  /** The written form of a token, for the proposals list. */
  token(id: Id): Token | undefined {
    const item = this.stream.items.find((i) => i.id === id);
    return isToken(item) ? item : undefined;
  }

  // Diacritics and case

  /** Words whose diacritics are left to choose after Normalize diacritics, with their options; empty options for a word the analyser does not know. */
  diacriticChoices = $state.raw<
    Map<Id, { options: FormOption[]; reason: 'several' | 'disagrees' | 'unknown' }>
  >(new Map());

  /** The words a tool acts on: those selected, else every word of the page shown. */
  private toolScope(): Id[] {
    if (this.hasRange && this.selection.ids.length) return this.selection.ids;
    return this.pageStream.items.filter((i) => isToken(i)).map((i) => i.id);
  }

  /** The field Normalize diacritics writes: the normalized form, or the only form. */
  private get normalizedField(): FormField {
    return this.keepsWrittenForm ? 'norm' : 'form';
  }

  /** Remove marks of some kinds from the diplomatic text (the only text where there is no other) of the words in scope. */
  removeMarks(kinds: MarkKind[]): number {
    const ops = removeMarksOps(this.stream, this.toolScope(), 'form', kinds);
    return this.apply(ops) ? ops.length : 0;
  }

  /** Make the words in scope lower or upper case, in the form shown. */
  changeCase(to: 'lower' | 'upper'): number {
    const field: FormField = this.editorForm === 'written' ? 'form' : 'norm';
    const ops = caseOps(this.stream, this.toolScope(), field, to);
    return this.apply(ops) ? ops.length : 0;
  }

  /**
   * Normalize the diacritics of the words in scope from the analyser's
   * forms: where one form fits it is set; the others are left in
   * `diacriticChoices`. Resolves with what came of it.
   */
  async normalizeDiacritics(): Promise<{ set: number; choose: number; unknown: number } | null> {
    const field = this.normalizedField;
    const scope = new Set(this.toolScope());
    const tokens = this.stream.items.filter((i): i is Token => isToken(i) && scope.has(i.id));
    const texts = [...new Set(tokens.map((t) => textOf(t, field)).filter((x) => x.trim() !== ''))];
    const analyses: Record<string, AnalysisLike[]> = {};
    try {
      for (let i = 0; i < texts.length; i += 250) {
        const query = texts
          .slice(i, i + 250)
          .map((w) => `w=${encodeURIComponent(w)}`)
          .join('&');
        const response = await fetch(`/api/greek/words?${query}`);
        if (!response.ok) return null;
        Object.assign(
          analyses,
          ((await response.json()) as { words: Record<string, AnalysisLike[]> }).words,
        );
      }
    } catch {
      return null;
    }
    const ops: Op[] = [];
    const choices = new Map(this.diacriticChoices);
    let set = 0;
    let unknown = 0;
    for (const token of tokens) {
      const current = textOf(token, field);
      const outcome = normalizeWord({
        current,
        diplomatic: this.keepsWrittenForm ? token.form : null,
        analyses: analyses[current] ?? [],
        remembered: this.keepsWrittenForm ? (this.memory.propose(token.form) ?? null) : null,
        next: nextWord(this.stream, token.id, field),
      });
      choices.delete(token.id);
      if (outcome.kind === 'set') {
        ops.push(setTextOp(token, field, outcome.value));
        set++;
      } else if (outcome.kind === 'choose')
        choices.set(token.id, { options: outcome.options, reason: outcome.reason });
      else if (outcome.kind === 'unknown') {
        choices.set(token.id, { options: [], reason: 'unknown' });
        unknown++;
      }
    }
    if (ops.length) this.apply(ops);
    this.diacriticChoices = choices;
    return { set, choose: choices.size - unknown, unknown };
  }

  /**
   * Take the normalized forms of another text (a transcription or an edition
   * of the same work) for the words in scope whose letters agree with the
   * words they stand against. Null when the other text could not be read.
   */
  async takeFormsFrom(source: {
    kind: 'transcription' | 'edition';
    id: string;
  }): Promise<{ taken: number; differing: number } | null> {
    const field = this.normalizedField;
    const scope = new Set(this.toolScope());
    const segmentIds = [
      ...new Set(
        segmentRuns(this.stream)
          .filter(
            (run) =>
              run.segmentId &&
              this.stream.items.slice(run.from, run.to).some((i) => scope.has(i.id)),
          )
          .map((run) => run.segmentId!),
      ),
    ];
    if (segmentIds.length === 0) return { taken: 0, differing: 0 };
    const url =
      source.kind === 'transcription'
        ? `/api/transcriptions/${source.id}/segments`
        : `/api/editions/${source.id}/units`;
    let there: Record<string, Unit[]>;
    try {
      const response = await fetch(`${url}?ids=${segmentIds.map(encodeURIComponent).join(',')}`);
      if (!response.ok) return null;
      const data = (await response.json()) as { segments: Record<string, { units: Unit[] }> };
      there = Object.fromEntries(
        Object.entries(data.segments).map(([id, s]) => [id, s.units] as const),
      );
    } catch {
      return null;
    }
    const here = Object.fromEntries(
      segmentIds.map((id) => [id, segmentUnits(this.stream, id)] as const),
    );
    const outcome = takeForms(this.stream, scope, field, this.keepsWrittenForm, here, there);
    if (outcome.ops.length) this.apply(outcome.ops);
    return { taken: outcome.taken, differing: outcome.differing };
  }

  /** Take one of a word's options, and remember it for the same diplomatic form. */
  chooseForm(id: Id, value: string): void {
    const token = this.token(id);
    if (!token) return;
    const field = this.normalizedField;
    if (this.apply([setTextOp(token, field, value)]) && this.keepsWrittenForm)
      this.remember([{ form: token.form, norm: value }]);
    this.dismissChoice(id);
  }

  /** Leave a word as it is: it is no longer offered. */
  dismissChoice(id: Id): void {
    if (!this.diacriticChoices.has(id)) return;
    const next = new Map(this.diacriticChoices);
    next.delete(id);
    this.diacriticChoices = next;
  }

  /** The word to choose before or after the caret, in text order, wrapping round. */
  nearbyChoice(direction: 1 | -1): Id | null {
    const order = this.stream.items.filter((i) => this.diacriticChoices.has(i.id)).map((i) => i.id);
    if (order.length === 0) return null;
    const caret = this.selection.caret;
    const at = caret ? this.stream.items.findIndex((i) => i.id === caret) : -1;
    const index = (id: Id) => this.stream.items.findIndex((i) => i.id === id);
    if (direction === 1) return order.find((id) => index(id) > at) ?? order[0]!;
    return [...order].reverse().find((id) => index(id) < at) ?? order[order.length - 1]!;
  }

  // Pages

  /** Show a view: `'unplaced'`, a page id, or `'whole'`. */
  goTo(view: string | null): void {
    if (view !== null) this.requestedView = view;
  }

  /** In Staging: show another page in the facsimile, which Move to Page… then proposes. */
  chooseFacsimilePage(pageId: string | null): void {
    this.facsimileChoice = pageId;
  }

  /** Say something in the status line for a while. */
  say(text: string, view: string | null = null): void {
    this.notice = { text, view };
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => (this.notice = null), 8000);
  }

  /** The label of a view, for messages. */
  viewLabel(view: string | null): string {
    if (view === null || view === UNPLACED) return t.pages.unplaced;
    if (view === WHOLE) return t.pages.whole;
    return this.pageLabels[view] ?? '';
  }

  // Moving text (C5, C6)

  /** The run of items the selection takes: its words whole, with what stands between the first and the last. */
  private selectedRun(): Id[] | null {
    const ids = this.api?.selectedTokens() ?? [];
    if (ids.length === 0) return null;
    const wanted = new Set(ids);
    const indexes = this.stream.items.flatMap((item, i) => (wanted.has(item.id) ? [i] : []));
    if (indexes.length === 0) return null;
    const run = this.stream.items.slice(indexes[0], indexes[indexes.length - 1]! + 1);
    if (run.some((item) => isBreak(item) && item.type === 'page')) return null;
    return run.map((item) => item.id);
  }

  /**
   * Move the selected words to the end of a page's text (`target` a page id)
   * or of the text on no page (`target` null), as one step the undo takes
   * back. Their boxes on the page they leave go. The view stays; when the
   * target was the proposed page, the proposal goes on to the next page
   * without text.
   */
  moveSelection(target: string | null): boolean {
    const api = this.api;
    if (!api || !this.canEdit || this.view === WHOLE) return false;
    const run = this.selectedRun();
    if (!run) return false;
    const source = pageOf(this.stream, run[0]!);
    const ops = moveToPage(this.stream, run, target, { pageOrder: this.pageOrder });
    if (ops.length === 0) return false;
    const proposed = this.proposedPage;
    if (!api.applyWhole(ops)) return false;
    const to = target ?? UNPLACED;
    if (source && source !== to && source !== UNPLACED) void this.detachZones(source, run);
    if (target !== null && target === proposed && this.view === UNPLACED) {
      this.facsimileChoice = nextPageWithoutText(this.pages, this.stream, target);
    }
    this.say(t.move.moved(this.viewLabel(to)), to);
    return true;
  }

  /** The words left a page: their boxes there lose them, and a box left with no word and no feature goes. */
  private async detachZones(pageId: string, ids: Id[]): Promise<void> {
    await this.loadZones(pageId);
    const gone = new Set(ids);
    const zones = this.zones[pageId] ?? [];
    const empty: string[] = [];
    for (const zone of zones) {
      if (!zone.tokenIds.some((id) => gone.has(id))) continue;
      const left = zone.tokenIds.filter((id) => !gone.has(id));
      if (left.length === 0 && !zone.feature) empty.push(zone.id);
      else void this.updateZoneTokens(pageId, zone.id, left);
    }
    if (empty.length) await this.deleteZones(pageId, empty);
  }

  private async updateZoneTokens(pageId: string, id: string, tokenIds: Id[]): Promise<boolean> {
    const before = this.zones[pageId] ?? [];
    this.setZones(
      pageId,
      before.map((z) => (z.id === id ? { ...z, tokenIds } : z)),
    );
    const response = await fetch(`/api/transcriptions/${this.id}/zones`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, tokenIds }),
    }).catch(() => null);
    if (!response?.ok) this.setZones(pageId, before);
    return !!response?.ok;
  }

  /** The editor is about to cut: what it takes is kept, so that pasting it moves the words (C6). */
  editorCut(record: CutRecord): void {
    this.cutWords = null;
    if (!this.canEdit || !record.whole || record.items.length === 0) return;
    const first = record.items.find((item) => item.kind !== 'break');
    const index = first ? this.stream.items.findIndex((item) => item.id === first.id) : -1;
    this.cutWords = {
      items: record.items,
      text: record.text,
      firstSegment: index >= 0 ? (segmentAt(this.stream, index) ?? null) : null,
      page: pageOf(this.stream, record.items[0]!.id),
    };
  }

  editorCopy(): void {
    this.cutWords = null;
  }

  /**
   * The editor is about to paste `text`: when it is what the last cut took
   * and those words are nowhere in the text, they are put back at the caret
   * with their ids, features and segments, and true is returned; otherwise
   * the editor's own paste makes new words.
   */
  editorPaste(text: string): boolean {
    const cut = this.cutWords;
    const api = this.api;
    if (!cut || !api || !this.canEdit || !sameText(text, cut.text)) return false;
    const present = new Set(this.stream.items.map((item) => item.id));
    if (cut.items.some((item) => present.has(item.id))) return false;
    const place = api.caretPlace();
    if (!place) return false;
    const ops: Op[] =
      'page' in place
        ? insertIntoPage(this.stream, cut.items, place.page, { pageOrder: this.pageOrder })
        : [{ t: 'insert', after: place.after, items: cut.items }];
    let placed: Stream;
    try {
      placed = applyOps(this.stream, ops).stream;
    } catch {
      return false;
    }
    // The cut words as they belonged: the first with the segment it had by flow.
    let given = false;
    const reference: Stream = {
      items: cut.items.map((item) => {
        if (given || item.kind === 'break') return item;
        given = true;
        return item.segment ? item : { ...item, segment: cut.firstSegment ?? { segmentId: null } };
      }),
    };
    ops.push(...repairSegmentStartsFrom([this.stream, reference], placed));
    if (!api.applyWhole(ops)) return false;
    const to = pageOf(this.stream, cut.items[0]!.id);
    if (cut.page && cut.page !== UNPLACED && cut.page !== to)
      void this.detachZones(
        cut.page,
        cut.items.map((item) => item.id),
      );
    this.cutWords = null;
    return true;
  }

  /** The pages screen of the witness, whose form actions change its pages. */
  get pagesBase(): string {
    return `/witnesses/${this.witness.slug}/pages`;
  }

  /**
   * Reads the witness's pages again, after a change on the Pages tab or an
   * image given on the facsimile: the views for the tab, and the pages the
   * text and the facsimile work with. Null when they could not be read.
   */
  async refreshPages(): Promise<WitnessPagesData | null> {
    let data: WitnessPagesData;
    try {
      const response = await fetch(`/api/witnesses/${this.witness.id}/pages`);
      if (!response.ok) return null;
      data = (await response.json()) as WitnessPagesData;
    } catch {
      return null;
    }
    this.pageViews = data.pages;
    this.pages = data.pages.map((p) => ({
      id: p.id,
      label: p.label,
      width: p.width,
      height: p.height,
      source: p.source,
      image: p.image,
      rights: p.rights,
      attribution: p.attribution,
    }));
    this.imageDefaults = data.witness.imageDefaults;
    this.seenLabels = {
      ...this.seenLabels,
      ...Object.fromEntries(data.pages.map((p) => [p.id, p.label])),
    };
    return data;
  }

  // Zones

  /** The zones of a page, loaded once; `force` loads again. */
  loadZones(pageId: string, force = false): Promise<void> {
    if (!force && (this.zones[pageId] || this.zoneLoads.has(pageId)))
      return this.zoneLoads.get(pageId) ?? Promise.resolve();
    const load = (async () => {
      try {
        const response = await fetch(
          `/api/transcriptions/${this.id}/zones?page=${encodeURIComponent(pageId)}`,
        );
        if (!response.ok) return;
        const data = (await response.json()) as { zones: Zone[] };
        this.zones = { ...untrack(() => this.zones), [pageId]: data.zones };
      } finally {
        this.zoneLoads.delete(pageId);
      }
    })();
    this.zoneLoads.set(pageId, load);
    return load;
  }

  setZones(pageId: string, zones: Zone[]): void {
    this.zones = { ...this.zones, [pageId]: zones };
  }

  /** Make zones on a page, replacing the zones that consist only of tokens being mapped again. */
  async createZones(
    pageId: string,
    inputs: {
      id?: string;
      geometry: ZoneGeometry;
      tokenIds: Id[];
      feature?: { kind: string; description?: string } | null;
    }[],
    replace: string[] = [],
  ): Promise<Zone[] | null> {
    if (!this.canEdit || inputs.length === 0) return null;
    if (replace.length) await this.deleteZones(pageId, replace);
    const response = await fetch(`/api/transcriptions/${this.id}/zones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        zones: inputs.map((z) => ({
          id: z.id,
          pageId,
          geometry: z.geometry,
          tokenIds: z.tokenIds,
          feature: z.feature ?? null,
        })),
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { zones: Zone[] };
    this.setZones(pageId, [...(this.zones[pageId] ?? []), ...data.zones]);
    return data.zones;
  }

  async updateZone(pageId: string, id: string, geometry: ZoneGeometry): Promise<boolean> {
    if (!this.canEdit) return false;
    const before = this.zones[pageId] ?? [];
    this.setZones(
      pageId,
      before.map((z) => (z.id === id ? { ...z, geometry } : z)),
    );
    const response = await fetch(`/api/transcriptions/${this.id}/zones`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, geometry }),
    });
    if (!response.ok) this.setZones(pageId, before);
    return response.ok;
  }

  /** New shapes for several zones of a page, saved together: all or none. */
  async updateZones(
    pageId: string,
    changes: { id: string; geometry: ZoneGeometry }[],
  ): Promise<boolean> {
    if (!this.canEdit || changes.length === 0) return false;
    const next = new Map(changes.map((c) => [c.id, c.geometry] as const));
    const before = this.zones[pageId] ?? [];
    this.setZones(
      pageId,
      before.map((z) => (next.has(z.id) ? { ...z, geometry: next.get(z.id)! } : z)),
    );
    const response = await fetch(`/api/transcriptions/${this.id}/zones`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zones: changes }),
    }).catch(() => null);
    if (!response?.ok) this.setZones(pageId, before);
    return !!response?.ok;
  }

  async deleteZones(pageId: string, ids: string[]): Promise<boolean> {
    if (!this.canEdit || ids.length === 0) return false;
    const gone = new Set(ids);
    const before = this.zones[pageId] ?? [];
    this.setZones(
      pageId,
      before.filter((z) => !gone.has(z.id)),
    );
    const response = await fetch(`/api/transcriptions/${this.id}/zones`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) this.setZones(pageId, before);
    return response.ok;
  }

  // Segments

  /** Learn segments: their labels and works. */
  addSegments(segments: Record<string, SegmentInfo>): void {
    this.segments = { ...this.segments, ...segments };
  }

  /** Resolve labels of a work to segments (found or created), in order; null when the server refuses. */
  async resolveLabels(
    workId: string,
    labels: string[],
  ): Promise<{ ok: true; ids: string[] } | { ok: false; message: string }> {
    const response = await fetch(`/api/works/${encodeURIComponent(workId)}/segments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(labels.length === 1 ? { label: labels[0] } : { labels }),
    });
    if (!response.ok) {
      let message = response.statusText;
      try {
        message = ((await response.json()) as { message?: string }).message ?? message;
      } catch {
        // No body.
      }
      return { ok: false, message };
    }
    const data = (await response.json()) as { segments: { id: string; label: string }[] };
    this.addSegments(
      Object.fromEntries(data.segments.map((s) => [s.id, { label: s.label, workId }])),
    );
    return { ok: true, ids: data.segments.map((s) => s.id) };
  }

  // Settings and imports

  applySettings(settings: {
    name: string;
    keepsWrittenForm: boolean;
    displayAsWritten: boolean;
    sources?: string | null;
    rightsNote?: string | null;
  }): void {
    const turnedOn = settings.keepsWrittenForm && !this.keepsWrittenForm;
    this.name = settings.name;
    if (settings.sources !== undefined) this.sources = settings.sources;
    if (settings.rightsNote !== undefined) this.rightsNote = settings.rightsNote;
    this.keepsWrittenForm = settings.keepsWrittenForm;
    this.displayAsWritten = settings.displayAsWritten;
    if (turnedOn) this.form = 'written';
  }

  applyImport(result: {
    outcome: { version: number; content: Stream };
    pages: WorkbenchPage[];
    segments: Record<string, SegmentInfo>;
    works: WorkbenchWork[];
  }): void {
    this.pages = result.pages;
    this.works = result.works;
    this.segments = result.segments;
    this.zones = {};
    this.replaceDocument(result.outcome);
    // Stay where the text was shown when it is still there; else go where the text now is.
    const current = this.requestedView;
    this.requestedView =
      current !== null && settleView(current, this.stream, this.pages) === current
        ? current
        : initialView(this.stream, this.pages);
  }
}
