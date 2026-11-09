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
import type { EditorApi } from '$lib/editor/editor';
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
  hasLeadingText,
  neighbours,
  nextUnplacedPage,
  initialPage,
  pageIdOfKey,
  pageKeyOf,
  settlePage,
  streamPages,
  unplacedPages,
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
  witness: { id: string; slug: string; siglum: string; name: string; hands: WitnessHand[]; imageDefaults?: ImageDefaults };
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
  /** The page asked for: a page key, a witness page without a break, or null for the whole text. */
  requestedPage = $state<string | null>(null);
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
    const pages = streamPages(this.stream, this.pageLabels, t.pages.fallback);
    this.requestedPage = initialPage(this.stream, pages, this.pages);
  }

  // Derived

  readonly pageLabels = $derived(Object.fromEntries(this.pages.map((p) => [p.id, p.label])));
  readonly segmentLabels = $derived(Object.fromEntries(Object.entries(this.segments).map(([id, s]) => [id, s.label])));
  readonly streamPages = $derived(streamPages(this.stream, this.pageLabels, t.pages.fallback));
  readonly unplaced = $derived(unplacedPages(this.pages, this.stream));
  /** The page shown: the requested one when it is still valid. */
  readonly page = $derived(settlePage(this.requestedPage, this.stream, this.streamPages, this.pages));
  /** The witness page behind the page shown, else the page the caret stands on in the whole text. */
  readonly pageId = $derived.by(() => {
    if (this.page !== null) return pageIdOfKey(this.page, this.streamPages, this.pages);
    const caret = this.selection.caret;
    const key = caret ? pageKeyOf(this.stream, caret, this.streamPages) : null;
    return pageIdOfKey(key, this.streamPages, this.pages);
  });
  readonly witnessPage = $derived(this.pages.find((p) => p.id === this.pageId) ?? null);
  readonly pageLabel = $derived(
    this.page === null
      ? t.status.wholeText
      : (this.streamPages.find((p) => p.key === this.page)?.label ?? this.pages.find((p) => p.id === this.page)?.label ?? ''),
  );
  readonly pageStream = $derived(pageView(this.stream, this.page).stream);
  /** The page the facsimile shows: its items, also in the whole text. */
  readonly facsimileStream = $derived(
    this.page === null && this.pageId ? pageView(this.stream, this.streamPages.find((p) => p.pageId === this.pageId)?.key ?? this.pageId).stream : this.pageStream,
  );
  readonly neighbours = $derived(neighbours(this.page, this.stream, this.streamPages, this.pages));
  readonly editorForm = $derived<Form>(this.keepsWrittenForm ? this.form : 'written');
  readonly otherForm = $derived<Form>(this.editorForm === 'written' ? 'read' : 'written');
  readonly lines = $derived(lineCount(this.pageStream));
  /** The spelling rules each word is read by: its stretch's work's, else the first work's. */
  readonly profile = $derived.by(() => profilesByWork(this.stream, this.segments, this.works, this.profileOverrides, this.workId));
  readonly unchecked = $derived(this.keepsWrittenForm ? uncheckedIn(this.pageStream).length : 0);
  readonly proposals = $derived.by(() => {
    void this.memoryTick;
    return this.keepsWrittenForm ? proposeNorms(this.pageStream, this.profile, this.memory) : [];
  });
  readonly pageZones = $derived(this.pageId ? (this.zones[this.pageId] ?? null) : null);
  readonly unmapped = $derived(this.pageZones && this.witnessPage?.source ? unmappedTokens(this.facsimileStream, this.pageZones) : []);
  readonly schemes = $derived(new Map(this.works.map((w) => [w.id, { levels: w.levels } satisfies Scheme])));

  /** Words selected in the editor, or the word at the caret. */
  readonly focusTokens = $derived(this.selection.ids.length ? this.selection.ids : this.selection.caret ? [this.selection.caret] : []);

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
          if (current()) this.setAside = dropped.length ? dropped : null;
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
    this.namePageBreaks(ops);
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

  /**
   * A page break made with the page break command names no page: it gets the
   * next witness page without a break, and the view goes to it.
   */
  private namePageBreaks(ops: Op[]): void {
    // A page break inserted, or a line break the command turned into one.
    const touched = new Set<Id>();
    for (const op of ops) {
      if (op.t === 'insert') for (const item of op.items) touched.add(item.id);
      else if (op.t === 'set' && op.fields.type === 'page') touched.add(op.id);
    }
    if (touched.size === 0) return;
    const made = this.stream.items.filter((item) => touched.has(item.id) && isBreak(item) && item.type === 'page' && !item.pageId).map((item) => item.id);
    if (made.length === 0) return;
    queueMicrotask(() => {
      let last: string | null = null;
      for (const id of made) {
        const next = nextUnplacedPage(this.stream, this.streamPages, this.pages);
        if (next && this.apply([{ t: 'set', id, fields: { pageId: next.id } }])) last = next.id;
        else last = id;
      }
      if (last && this.page !== null) this.requestedPage = last;
    });
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
  diacriticChoices = $state.raw<Map<Id, { options: FormOption[]; reason: 'several' | 'disagrees' | 'unknown' }>>(new Map());

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
        const query = texts.slice(i, i + 250).map((w) => `w=${encodeURIComponent(w)}`).join('&');
        const response = await fetch(`/api/greek/words?${query}`);
        if (!response.ok) return null;
        Object.assign(analyses, ((await response.json()) as { words: Record<string, AnalysisLike[]> }).words);
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
      } else if (outcome.kind === 'choose') choices.set(token.id, { options: outcome.options, reason: outcome.reason });
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
  async takeFormsFrom(source: { kind: 'transcription' | 'edition'; id: string }): Promise<{ taken: number; differing: number } | null> {
    const field = this.normalizedField;
    const scope = new Set(this.toolScope());
    const segmentIds = [...new Set(segmentRuns(this.stream).filter((run) => run.segmentId && this.stream.items.slice(run.from, run.to).some((i) => scope.has(i.id))).map((run) => run.segmentId!))];
    if (segmentIds.length === 0) return { taken: 0, differing: 0 };
    const url = source.kind === 'transcription' ? `/api/transcriptions/${source.id}/segments` : `/api/editions/${source.id}/units`;
    let there: Record<string, Unit[]>;
    try {
      const response = await fetch(`${url}?ids=${segmentIds.map(encodeURIComponent).join(',')}`);
      if (!response.ok) return null;
      const data = (await response.json()) as { segments: Record<string, { units: Unit[] }> };
      there = Object.fromEntries(Object.entries(data.segments).map(([id, s]) => [id, s.units] as const));
    } catch {
      return null;
    }
    const here = Object.fromEntries(segmentIds.map((id) => [id, segmentUnits(this.stream, id)] as const));
    const outcome = takeForms(this.stream, scope, field, this.keepsWrittenForm, here, there);
    if (outcome.ops.length) this.apply(outcome.ops);
    return { taken: outcome.taken, differing: outcome.differing };
  }

  /** Take one of a word's options, and remember it for the same diplomatic form. */
  chooseForm(id: Id, value: string): void {
    const token = this.token(id);
    if (!token) return;
    const field = this.normalizedField;
    if (this.apply([setTextOp(token, field, value)]) && this.keepsWrittenForm) this.remember([{ form: token.form, norm: value }]);
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

  goTo(page: string | null): void {
    this.requestedPage = page;
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
    return data;
  }

  /** Begin a witness page at the caret, and show it. */
  placePage(pageId: string): boolean {
    const api = this.api;
    if (!api || !this.canEdit) return false;
    const done = api.insertBreak('page', pageId);
    // Show the page placed, unless words before the first page break are seen only in the whole text.
    if (done && (this.page !== null || !hasLeadingText(this.stream))) this.requestedPage = pageId;
    return done;
  }

  // Zones

  /** The zones of a page, loaded once; `force` loads again. */
  loadZones(pageId: string, force = false): Promise<void> {
    if (!force && (this.zones[pageId] || this.zoneLoads.has(pageId))) return this.zoneLoads.get(pageId) ?? Promise.resolve();
    const load = (async () => {
      try {
        const response = await fetch(`/api/transcriptions/${this.id}/zones?page=${encodeURIComponent(pageId)}`);
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
  async createZones(pageId: string, inputs: { id?: string; geometry: ZoneGeometry; tokenIds: Id[]; feature?: { kind: string; description?: string } | null }[], replace: string[] = []): Promise<Zone[] | null> {
    if (!this.canEdit || inputs.length === 0) return null;
    if (replace.length) await this.deleteZones(pageId, replace);
    const response = await fetch(`/api/transcriptions/${this.id}/zones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zones: inputs.map((z) => ({ id: z.id, pageId, geometry: z.geometry, tokenIds: z.tokenIds, feature: z.feature ?? null })) }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { zones: Zone[] };
    this.setZones(pageId, [...(this.zones[pageId] ?? []), ...data.zones]);
    return data.zones;
  }

  async updateZone(pageId: string, id: string, geometry: ZoneGeometry): Promise<boolean> {
    if (!this.canEdit) return false;
    const before = this.zones[pageId] ?? [];
    this.setZones(pageId, before.map((z) => (z.id === id ? { ...z, geometry } : z)));
    const response = await fetch(`/api/transcriptions/${this.id}/zones`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, geometry }),
    });
    if (!response.ok) this.setZones(pageId, before);
    return response.ok;
  }

  /** New shapes for several zones of a page, saved together: all or none. */
  async updateZones(pageId: string, changes: { id: string; geometry: ZoneGeometry }[]): Promise<boolean> {
    if (!this.canEdit || changes.length === 0) return false;
    const next = new Map(changes.map((c) => [c.id, c.geometry] as const));
    const before = this.zones[pageId] ?? [];
    this.setZones(pageId, before.map((z) => (next.has(z.id) ? { ...z, geometry: next.get(z.id)! } : z)));
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
    this.setZones(pageId, before.filter((z) => !gone.has(z.id)));
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
  async resolveLabels(workId: string, labels: string[]): Promise<{ ok: true; ids: string[] } | { ok: false; message: string }> {
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
    this.addSegments(Object.fromEntries(data.segments.map((s) => [s.id, { label: s.label, workId }])));
    return { ok: true, ids: data.segments.map((s) => s.id) };
  }

  // Settings and imports

  applySettings(settings: { name: string; keepsWrittenForm: boolean; displayAsWritten: boolean; sources?: string | null; rightsNote?: string | null }): void {
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
    // Stay on a page of the text; from an empty page (or the whole text) go where the text now begins.
    const pages = streamPages(this.stream, this.pageLabels, t.pages.fallback);
    const current = this.requestedPage;
    this.requestedPage = current !== null && pages.some((p) => p.key === current) ? current : initialPage(this.stream, pages, this.pages);
  }
}
