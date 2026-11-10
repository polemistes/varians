<script lang="ts">
  /**
   * The edition editor: the critical text in an ordinary
   * editor, the apparatus of the segments around the caret in a band at the
   * foot, one witness beside it. Adopting a reading replaces the edition's
   * words at a site with that reading's words, which remember where they
   * came from; every change saves as operations and the segments it touched
   * are collated again.
   */
  import { onMount, untrack } from 'svelte';
  import {
    applyOps,
    nextLabel,
    printPlace,
    siteTokenIds,
    type Attachment,
    type Id,
    type Lineation,
    type Op,
    type Scheme,
    type Site,
    type SiteKind,
    type Stream,
  } from '@varians/core';
  import TextEditor from '$lib/components/editor/TextEditor.svelte';
  import type { EditorApi } from '$lib/editor/editor';
  import { DocumentSession, fetchTransport } from '$lib/editor/session';
  import {
    Button,
    Checkbox,
    Menu,
    MenuItem,
    MenuSeparator,
    Tabs,
    toasts,
    type Tab,
    Splitter,
  } from '$lib/components/ui';
  import ApparatusBand, { type Choice } from './ApparatusBand.svelte';
  import ConjectureDialog, { type ConjectureDraft } from './ConjectureDialog.svelte';
  import NoteDialog from './NoteDialog.svelte';
  import { PaneSize } from '$lib/layout/pane-size.svelte';
  import { formatCitation } from '$lib/bibliography/format';
  import type { CitationDraft } from '$lib/bibliography/types';
  import ObjectDialog, { type InsertKind } from './ObjectDialog.svelte';
  import SegmentDialog from './SegmentDialog.svelte';
  import WitnessPane from './WitnessPane.svelte';
  import { keyOfSite, opsForAttachment, opsForReading } from '$lib/edition/adopt-client';
  import { EditionText } from '$lib/reader/edition-text';
  import { DEFAULT_SIGLA } from '$lib/reader/marks';
  import { variantOf, type VariantContext } from '$lib/reader/variant';
  import {
    mergePassages,
    passageIndex,
    passagesOf,
    standsIn,
    unprintedAt,
  } from '$lib/reader/passages';
  import { parseSiteKey, siteKey as keyOfVariant, siteLabel } from '$lib/reader/sites';
  import { countNeeding, outlineOf, type SegmentOutline } from '$lib/edition/outline';
  import {
    activeSiteFor,
    insertedIds,
    insertionSite,
    itemsAround,
    moveLinesOps,
    claimTypedWords,
    takeCurrentOps,
    segmentOfItem,
    segmentOrder,
    segmentsTouched,
    siteForTokens,
    sitesInOrder,
    stepSite,
    tokenClassesFor,
    unprintedMarks,
    windowAround,
    witnessIndex,
    witnessTokensAt,
  } from '$lib/edition/workspace';
  import type { ActiveSite, EditionViewClient, SegmentViewClient } from '$lib/edition/types';
  import { editor as s } from '$lib/strings/editor';

  export interface WorkspaceStatus {
    pending: number;
    saving: boolean;
    error: string | null;
    version: number;
  }

  export interface WorkspaceController {
    /** Save everything pending; resolves when nothing is left or a failure stopped it. */
    flush(): Promise<void>;
  }

  interface Props {
    view: EditionViewClient;
    reviewed: Record<string, string[]>;
    canEdit: boolean;
    userName: string;
    controller?: WorkspaceController | null;
    onstatus?: (status: WorkspaceStatus) => void;
  }

  let {
    view,
    reviewed: initialReviewed,
    canEdit,
    userName,
    controller = $bindable(null),
    onstatus,
  }: Props = $props();

  const editionId = untrack(() => view.edition.id);
  const workId = untrack(() => view.work.id);
  const sigla = untrack(() => view.sigla);
  const json = { 'content-type': 'application/json' };

  let stream = $state.raw<Stream>(untrack(() => view.content));
  // The segments the editor has been given in full (those it has shown), and the outline of every segment of the text.
  let views = $state.raw<Record<Id, SegmentViewClient>>(untrack(() => view.segments));
  let outlines = $state.raw<Record<Id, SegmentOutline>>(
    untrack(() =>
      Object.fromEntries(Object.values(view.segments).map((v) => [v.segmentId, outlineOf(v)])),
    ),
  );
  /** The outline of the whole text has come: until then the marks, the count and the steps cover what has been given. */
  let outlineReady = $state(false);
  let labelOf = $state.raw<Record<Id, string>>(untrack(() => view.labelOf));
  let reviewed = $state.raw<Record<Id, string[]>>(untrack(() => initialReviewed));
  let active = $state.raw<ActiveSite | null>(null);
  let caretSegment = $state<Id | null>(null);
  let selection = $state.raw<{ ids: Id[]; caret: Id | null }>({ ids: [], caret: null });
  let stale = $state.raw<Set<Id>>(new Set());
  let orderVariants = $state.raw<EditionViewClient['orderVariants']>(
    untrack(() => view.orderVariants ?? []),
  );
  let api = $state<EditorApi | null>(null);
  let witnessSiglum = $state<string | null>(
    untrack(() => view.sigla.find((x) => x.transcriptionId)?.siglum ?? null),
  );
  let witnessMode = $state<'text' | 'image'>('text');
  let side = $state('witnesses');
  let colourBySource = $state(false);
  let scheme: Scheme | null = null;
  /**
   * The last adoption, to take back with one click while nothing else has
   * happened; `restore` says again the editor's word that the adoption cleared.
   */
  let lastAdoption = $state.raw<{
    reverse: Op[];
    label: string;
    restore?: () => Promise<void>;
  } | null>(null);

  // Saving

  let lastVersion = $state(untrack(() => view.edition.version));
  const session = new DocumentSession(
    { content: untrack(() => view.content), version: untrack(() => view.edition.version) },
    fetchTransport(`/api/documents/edition/${editionId}/ops`),
    {
      onChange: (state) => {
        onstatus?.({
          pending: state.pending,
          saving: state.saving,
          error: state.error,
          version: state.version,
        });
        if (state.version !== lastVersion) {
          lastVersion = state.version;
          if (state.pending === 0 && !state.saving) void refreshStale();
        }
      },
      onConflict: () => toasts.error(s.workspace.conflict),
      onExternalContent: (next) => {
        stream = next;
        void reloadAll();
      },
    },
  );
  controller = { flush: () => session.flush() };

  /** Take operations made here (in the editor or by adopting) into the stream and the session. */
  function commit(ops: Op[], next: Stream, before: Stream) {
    if (ops.length === 0) return;
    const touched = segmentsTouched(before, next, ops);
    stream = next;
    session.apply(ops, next);
    if (touched.length) stale = new Set([...stale, ...touched]);
  }

  /** Words taken from a witness that now reads otherwise get its present reading. */
  function takeCurrent(segmentId: Id, drift: { tokenId: Id; now: string }[]) {
    void segmentId;
    const before = stream;
    let next = before;
    const ops: Op[] = [];
    for (const d of drift) {
      const step = takeCurrentOps(next, d);
      if (!step.length) continue;
      next = applyOps(next, step).stream;
      ops.push(...step);
    }
    lastAdoption = null;
    commit(ops, next, before);
  }

  function onEditorOps(ops: Op[], next: Stream) {
    lastAdoption = null;
    // Letters typed over a witness's or a conjecture's word make it the editor's.
    const claims = claimTypedWords(stream, ops);
    if (claims.length) commit([...ops, ...claims], applyOps(next, claims).stream, stream);
    else commit(ops, next, stream);
  }

  // Collating again what an edit touched

  let refreshing = false;
  let refreshAgain = false;
  /** Sites to mark as reviewed once their segment has been collated again. */
  let reviewAfter: { segmentId: Id; ids: Id[]; before: Id | null; printed?: Id | null }[] = [];

  async function refreshStale(): Promise<void> {
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    const touched = [...stale];
    if (touched.length === 0) return;
    // Every segment of the passages the edit touched: the passages around it may be drawn otherwise now.
    const ids = [
      ...new Set([
        ...touched,
        ...passagesOf(touched, passageOf).flatMap(
          (id) => views[id]?.segments.map((x) => x.segmentId) ?? [],
        ),
      ]),
    ];
    refreshing = true;
    try {
      const response = await fetch(
        `/api/editions/${editionId}/view?segments=${encodeURIComponent(ids.join(','))}`,
      );
      if (!response.ok) throw new Error(response.statusText);
      const data = (await response.json()) as {
        segments: Record<Id, SegmentViewClient>;
        orderVariants?: EditionViewClient['orderVariants'];
      };
      if (data.orderVariants) orderVariants = data.orderVariants;
      take(data.segments);
      // Edits made while the answer travelled are newer than it: those segments stay stale.
      if (session.state.pending === 0 && !session.state.saving) {
        const left = new Set(stale);
        for (const id of ids) left.delete(id);
        stale = left;
        markReviewedAfterRefresh(ids);
      }
    } catch {
      // The next save tries again.
    } finally {
      refreshing = false;
      if (refreshAgain) {
        refreshAgain = false;
        void refreshStale();
      }
    }
  }

  /**
   * Take in passages that have come: each takes the place of the passages
   * given before that hold any of its segments, in the views and in the
   * outline, since an edit can draw the passages around it otherwise.
   */
  function take(incoming: Record<Id, SegmentViewClient>) {
    if (Object.keys(incoming).length === 0) return;
    views = mergePassages(views, incoming);
    const taken = new Set(
      Object.values(incoming).flatMap((p) => p.segments.map((x) => x.segmentId)),
    );
    const nextOutlines: Record<Id, SegmentOutline> = {};
    for (const [id, outline] of Object.entries(outlines))
      if (!outline.segments.some((x) => taken.has(x.segmentId))) nextOutlines[id] = outline;
    for (const [id, segment] of Object.entries(incoming)) nextOutlines[id] = outlineOf(segment);
    outlines = nextOutlines;
    const nextLabels = { ...labelOf };
    for (const segment of Object.values(incoming))
      for (const part of segment.segments) nextLabels[part.segmentId] = part.label;
    labelOf = nextLabels;
  }

  /** Start again from what the server has: the segments on show are asked for anew, and the outline. */
  async function reloadAll(): Promise<void> {
    views = {};
    outlines = {};
    outlineReady = false;
    loading = new Set();
    await Promise.all([ensureShown(), loadOutline()]);
    if (session.state.pending === 0) stale = new Set();
  }

  // Giving the editor the segments it shows

  /** Segments asked for and not yet given. */
  let loading = new Set<Id>();
  /** What the caret's segment shows once it has been given, when the caret reached it before. */
  let selectionWaiting = false;

  /** How far each side of the caret segments are asked for, so that moving on does not ask again at once. */
  const PREFETCH_RADIUS = 16;

  /** Ask for the segments of the window that have not been given, and those around it. */
  async function ensureShown(): Promise<void> {
    const missing = windowIds.filter((id) => !viewOf(id) && !loading.has(id));
    if (missing.length === 0) return;
    const center = caretSegment ?? centreOfActive();
    await ensure(
      windowAround(sequence, outlines, center, PREFETCH_RADIUS).filter(
        (id) => !viewOf(id) && !loading.has(id),
      ),
    );
  }

  /** Have the passages that hold these segments in full: asked for in one request, and put among the others. */
  async function ensure(ids: Id[]): Promise<void> {
    const wanted = ids.filter((id) => !viewOf(id) && !loading.has(id));
    if (wanted.length === 0) {
      // Another request is bringing them: wait for it.
      while (ids.some((id) => loading.has(id) && !viewOf(id)))
        await new Promise((r) => setTimeout(r, 50));
      return;
    }
    for (const id of wanted) loading.add(id);
    try {
      const response = await fetch(
        `/api/editions/${editionId}/view?segments=${encodeURIComponent(wanted.join(','))}`,
      );
      if (!response.ok) throw new Error(response.statusText);
      const data = (await response.json()) as {
        segments: Record<Id, SegmentViewClient>;
        orderVariants?: EditionViewClient['orderVariants'];
      };
      if (data.orderVariants) orderVariants = data.orderVariants;
      // A passage given meanwhile, or one of whose segments was edited meanwhile, is newer than this.
      const fresh: Record<Id, SegmentViewClient> = {};
      for (const [id, segment] of Object.entries(data.segments)) {
        const parts = segment.segments.map((x) => x.segmentId);
        if (parts.some((x) => stale.has(x))) continue;
        if (parts.every((x) => viewOf(x))) continue;
        fresh[id] = segment;
      }
      take(fresh);
      settleSelection();
    } catch {
      // The window asks again when it moves.
    } finally {
      for (const id of wanted) loading.delete(id);
    }
  }

  /** The outline of the whole text, asked for once the editor is open. */
  async function loadOutline(): Promise<void> {
    try {
      const response = await fetch(`/api/editions/${editionId}/outline`);
      if (!response.ok) throw new Error(response.statusText);
      const data = (await response.json()) as {
        outline: Record<Id, SegmentOutline>;
        labelOf: Record<Id, string>;
      };
      // What the editor has in full is at least as new as the outline.
      const given = new Set(
        Object.values(views).flatMap((p) => p.segments.map((x) => x.segmentId)),
      );
      const next: Record<Id, SegmentOutline> = {};
      for (const [id, outline] of Object.entries(data.outline))
        if (!outline.segments.some((x) => given.has(x.segmentId))) next[id] = outline;
      for (const [id, segment] of Object.entries(views)) next[id] = outlineOf(segment);
      outlines = next;
      labelOf = { ...data.labelOf, ...labelOf };
      outlineReady = true;
    } catch {
      // The marks of the segments given so far stay; the next change of the text asks again.
    }
  }

  function markReviewedAfterRefresh(refreshed: Id[]) {
    const done = new Set(refreshed);
    const waiting = reviewAfter;
    reviewAfter = [];
    for (const entry of waiting) {
      if (!done.has(entry.segmentId)) {
        reviewAfter.push(entry);
        continue;
      }
      const segment = viewOf(entry.segmentId);
      if (!segment) continue;
      const site = siteAfterAdoption(segment, entry.ids, entry.before, entry.printed);
      if (site) void setReviewed(segment.segmentId, site, true);
    }
  }

  /**
   * The site an adoption left: the one holding the new words, or the gap where
   * removed words stood. Of a segment just printed, the one over the whole
   * segment for the witnesses without it comes first: it is what the variant
   * of the line not printed has become.
   */
  function siteAfterAdoption(
    segment: SegmentViewClient,
    ids: Id[],
    before: Id | null,
    printed: Id | null = null,
  ): Site | null {
    const wanted = new Set(ids);
    const whole =
      printed !== null
        ? segment.collation.sites.find(
            (site) => site.wanting && (segment.siteSegments[site.index] ?? []).includes(printed),
          )
        : undefined;
    if (whole) return whole;
    for (const site of segment.collation.sites) {
      if (siteTokenIds(site, segment.baseUnits).some((id) => wanted.has(id))) return site;
    }
    const at =
      before === null ? 0 : segment.baseUnits.findIndex((u) => u.tokenIds.includes(before)) + 1;
    return (
      segment.collation.sites.find((site) => site.baseFrom === at && site.baseTo === at) ?? null
    );
  }

  // What is on show

  const sequence = $derived(segmentOrder(stream));
  /** The passage that holds each segment the editor has in full, by its first segment. */
  const passageOf = $derived(passageIndex(Object.values(views)));
  /** The passage the editor has in full that holds a segment. */
  function viewOf(segmentId: Id | null): SegmentViewClient | undefined {
    if (segmentId === null) return undefined;
    const at = passageOf.get(segmentId);
    return at === undefined ? undefined : views[at];
  }
  /** The segment the active variant stands in. */
  function centreOfActive(): Id | null {
    if (!active) return null;
    const segment = views[active.segmentId];
    return segment ? standsIn(segment, active.siteIndex) : active.segmentId;
  }
  const windowIds = $derived(windowAround(sequence, outlines, caretSegment ?? centreOfActive()));
  /** The passages that hold the segments on show. */
  const windowSegments = $derived(
    passagesOf(windowIds, passageOf)
      .map((id) => views[id])
      .filter((v): v is SegmentViewClient => v !== undefined),
  );
  /** The segments on show, each followed by those its passage holds that the edition does not print: what the witness beside the text shows. */
  const shownWithUnprinted = $derived.by(() => {
    const parts = new Map<Id, Id[]>();
    for (const outline of Object.values(outlines)) {
      let last: Id | null = null;
      for (const part of outline.segments) {
        if (part.printed) last = part.segmentId;
        else if (last !== null) parts.set(last, [...(parts.get(last) ?? []), part.segmentId]);
      }
    }
    // A segment just adopted is in the text already while the outline still has it as not printed
    // (until the server has answered), and an outline may name one twice: each segment is shown once.
    const seen = new Set<Id>(windowIds);
    return windowIds.flatMap((id) => [
      id,
      ...(parts.get(id) ?? []).filter((part) => !seen.has(part) && seen.add(part)),
    ]);
  });
  /** The edition's words as it prints them, for the first row of a variant and its head. */
  const editionText = $derived(
    new EditionText(
      itemsAround(stream, windowSegments),
      view.edition.conventions.sigla ?? DEFAULT_SIGLA,
    ),
  );
  /** What a variant reads, as the reader's window does: the conspectus, the edition's groups and words, the labels of the segments, and where witnesses order lines otherwise. */
  const variantContext = $derived<VariantContext>({
    sigla,
    groups: view.edition.conventions.groups,
    edition: editionText,
    labelOf,
    order: sequence,
    orders: orderVariants,
    passages: views,
  });
  const tokenClasses = $derived(
    tokenClassesFor(Object.values(outlines), { active, colourBySource, stream }),
  );
  /** The edition's kind of a paragraph that is not marked: verse or prose. */
  const lineation = $derived(view.edition.conventions.lineation ?? 'verse');
  // A segment the edition does not print is marked while its variant shows: between the lines it stands between in verse, in prose by the point after the words before it.
  const marginMarks = $derived(
    unprintedMarks(stream, sequence, outlines, lineation).map((mark) => ({
      key: keyOfVariant(mark.passage, mark.site.index),
      after: mark.after,
      title: s.notPrinted(labelOf[mark.segmentId] ?? ''),
      active: active?.segmentId === mark.passage && active.siteIndex === mark.site.index,
      inText: mark.inText,
    })),
  );
  const reviewedMap = $derived(
    new Map(Object.entries(reviewed).map(([id, keys]) => [id, new Set(keys)] as const)),
  );
  const allSites = $derived(sitesInOrder(sequence, outlines).length);
  const unreviewed = $derived(countNeeding(outlines, reviewedMap));
  const witnessIdx = $derived(witnessIndex(windowSegments));
  const witnessTextId = $derived(
    sigla.find((x) => x.siglum === witnessSiglum)?.transcriptionId ?? null,
  );
  const witnessHighlight = $derived.by(() => {
    if (!active || !witnessTextId) return [] as Id[];
    const site = views[active.segmentId]?.collation.sites.find(
      (x) => x.index === active!.siteIndex,
    );
    return site ? witnessTokensAt(site, witnessTextId) : [];
  });

  // The caret and the site

  function onSelection(ids: Id[], caret: Id | null) {
    selection = { ids, caret };
    const anchor = caret ?? ids[0] ?? null;
    if (!anchor) return;
    const segmentId = segmentOfItem(stream, anchor);
    caretSegment = segmentId;
    const segment = viewOf(segmentId);
    active = segment ? activeSiteFor([segment], ids, caret) : null;
    // A segment not yet given has no places to find: the selection is read again when it comes.
    selectionWaiting = !segment && segmentId !== null;
  }

  /** Read the selection again, if it reached a segment before that was given. */
  function settleSelection() {
    if (!selectionWaiting || !caretSegment) return;
    const segment = viewOf(caretSegment);
    if (!segment) return;
    selectionWaiting = false;
    active = activeSiteFor([segment], selection.ids, selection.caret);
  }

  /** Bring the text to the first of the lines a variant over their order concerns. */
  function focusLines(segmentId: Id) {
    caretSegment = segmentId;
    const segment = viewOf(segmentId);
    const part = segment?.segments.find((x) => x.segmentId === segmentId);
    const first = part ? segment?.baseUnits[part.from]?.tokenIds[0] : undefined;
    if (first) api?.scrollToToken(first);
  }

  /** Show a witness beside the text: the chosen one in the witness pane. */
  function showWitness(siglum: string) {
    witnessSiglum = siglum;
    side = 'witnesses';
  }

  function focusSite(segmentId: Id, site: Site) {
    active = { segmentId, siteIndex: site.index };
    const segment = views[segmentId];
    caretSegment = segment ? standsIn(segment, site.index) : segmentId;
    if (!segment || !api) return;
    const unprinted = unprintedAt(segment, site.index);
    if (unprinted) {
      // A segment the edition does not print: the text is brought to where it would stand. A selection
      // of other words is let go, the caret staying where it is, and the variant stays the active one.
      api.clearSelection();
      selectionTick++;
      active = { segmentId, siteIndex: site.index };
      caretSegment = unprinted.segmentId;
      const place = printPlace(stream, unprinted.after);
      if (place) api.scrollToToken(place);
      return;
    }
    const ids = siteTokenIds(site, segment.baseUnits);
    if (ids.length) {
      api.selectTokens(ids[0]!, ids[ids.length - 1]!);
    } else {
      const before = segment.baseUnits[site.baseFrom - 1]?.tokenIds;
      const near = before?.[before.length - 1] ?? segment.baseUnits[site.baseFrom]?.tokenIds[0];
      if (near) api.scrollToToken(near);
      active = { segmentId, siteIndex: site.index };
    }
  }

  /** Open the variant of a segment the edition does not print, from its mark in the text (by the variant's key). */
  async function openUnprinted(key: string) {
    const ref = parseSiteKey(key);
    if (!ref) return;
    const outline = outlines[ref.segmentId]?.sites.find((x) => x.index === ref.siteIndex);
    caretSegment = outline?.unprinted?.segmentId ?? ref.segmentId;
    active = { segmentId: ref.segmentId, siteIndex: ref.siteIndex };
    await ensure([ref.segmentId]);
    const site = views[ref.segmentId]?.collation.sites.find((x) => x.index === ref.siteIndex);
    if (site) focusSite(ref.segmentId, site);
  }

  async function step(direction: 1 | -1, unreviewedOnly: boolean) {
    const ref = stepSite(
      sequence,
      outlines,
      active,
      direction,
      reviewed,
      unreviewedOnly,
      caretSegment,
    );
    if (!ref) return;
    // The place may be in a segment not yet given: the window moves there, and the place is found once it comes.
    caretSegment = ref.site.unprinted?.segmentId ?? ref.site.segments[0] ?? ref.segmentId;
    active = { segmentId: ref.segmentId, siteIndex: ref.site.index };
    await ensure([ref.segmentId]);
    const site = views[ref.segmentId]?.collation.sites.find((x) => x.index === ref.site.index);
    if (site) focusSite(ref.segmentId, site);
  }

  // Adopting

  /** The token before the first word of a site in the stream, for finding the site again after its words are gone. */
  function tokenBefore(ids: Id[], segment: SegmentViewClient, site: Site): Id | null {
    if (ids.length === 0) {
      const before = segment.baseUnits[site.baseFrom - 1]?.tokenIds;
      return before?.[before.length - 1] ?? null;
    }
    const index = stream.items.findIndex((item) => item.id === ids[0]);
    for (let i = index - 1; i >= 0; i--)
      if (stream.items[i]!.kind === 'token') return stream.items[i]!.id;
    return null;
  }

  async function postAdoption(conjectureId: Id, adopted: boolean) {
    await fetch(`/api/editions/${editionId}/adoptions`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ conjectureId, adopted }),
    });
  }

  /** Whether an edit of a passage is still being saved and collated. */
  function isStale(segment: SegmentViewClient): boolean {
    return segment.segments.some((x) => stale.has(x.segmentId));
  }

  async function adopt(segmentId: Id, site: Site, choice: Choice, textId?: Id) {
    if (!canEdit) return;
    const segment = views[segmentId];
    if (!segment) return;
    if (isStale(segment)) {
      toasts.info(s.workspace.stillSaving);
      return;
    }
    const unprinted = unprintedAt(segment, site.index);
    const before = stream;
    let ops: Op[];
    let next: Stream;
    let reverse: Op[];
    try {
      ops =
        choice.kind === 'reading'
          ? opsForReading(
              before,
              segment,
              site,
              choice.reading,
              textId ?? choice.reading.textIds[0]!,
              lineation,
            )
          : opsForAttachment(
              before,
              segment,
              site,
              choice.attachment,
              (choice.attachment as { segmentId?: Id }).segmentId ?? unprinted?.segmentId,
              lineation,
            );
      if (ops.length === 0) return;
      const applied = applyOps(before, ops);
      next = applied.stream;
      reverse = applied.reverse;
    } catch {
      toasts.error(s.workspace.adoptFailed);
      return;
    }
    const siteIds = siteTokenIds(site, segment.baseUnits);
    const printing = unprinted !== null;
    const restore = printing ? await clearUnprintedWord(segmentId, site) : undefined;
    // The conjectures the site printed until now are no longer printed, unless it is the one chosen.
    for (const attachment of segment.attachments[site.index] ?? []) {
      if (attachment.kind !== 'conjecture' || !attachment.adopted) continue;
      if (choice.kind === 'attachment' && choice.attachment.id === attachment.id) continue;
      await postAdoption(attachment.id, false);
    }
    if (choice.kind === 'attachment' && choice.attachment.kind === 'conjecture')
      await postAdoption(choice.attachment.id, true);
    reviewAfter.push({
      segmentId: unprinted?.segmentId ?? standsIn(segment, site.index),
      ids: insertedIds(ops).concat(
        choice.kind === 'attachment' && choice.attachment.conjectureKind === 'deletion'
          ? siteIds
          : [],
      ),
      before: tokenBefore(siteIds, segment, site),
      printed: unprinted?.segmentId ?? null,
    });
    commit(ops, next, before);
    lastAdoption = {
      reverse,
      label: siteLabel(segment, site.index, labelOf),
      ...(restore ? { restore } : {}),
    };
    await session.flush();
  }

  /**
   * The editor's word on the variant of a segment the edition does not print
   * (reviewed, its kind, minor) is kept under a key that names no word of
   * the edition, so it would hold again whenever the line is not printed.
   * Printing the line clears it; the function returned says it again, for
   * Undo. Nothing when there was nothing to clear.
   */
  async function clearUnprintedWord(
    segmentId: Id,
    site: Site,
  ): Promise<(() => Promise<void>) | undefined> {
    const segment = views[segmentId];
    if (!segment) return undefined;
    const key = keyOfSite(segment, site);
    // Kept under the segment the variant is: the one not printed.
    const at = standsIn(segment, site.index);
    const wasReviewed = segment.segments.some((x) => (reviewed[x.segmentId] ?? []).includes(key));
    const said = {
      ...(site.kindByEditor ? { kind: site.kind } : {}),
      ...(site.minor ? { minor: true } : {}),
    };
    const marked = Object.keys(said).length > 0;
    if (!wasReviewed && !marked) return undefined;
    const mark = (body: Record<string, unknown>) =>
      fetch(`/api/editions/${editionId}/site-kinds`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ segmentId: at, siteKey: key, ...body }),
      });
    if (wasReviewed) await setReviewedKey(at, key, false);
    if (marked) await mark({ kind: null, minor: false });
    return async () => {
      if (wasReviewed) await setReviewedKey(at, key, true);
      if (marked) await mark(said);
    };
  }

  async function undoAdoption() {
    const last = lastAdoption;
    if (!last) return;
    lastAdoption = null;
    try {
      const next = applyOps(stream, last.reverse).stream;
      // Said again before the text changes, so that the segments collated again carry it.
      await last.restore?.();
      commit(last.reverse, next, stream);
      await session.flush();
    } catch {
      toasts.error(s.workspace.adoptFailed);
    }
  }

  /** Move the lines holding the selection (or the caret) one line up or down: a transposition of whole lines. */
  async function moveLines(direction: -1 | 1) {
    if (!canEdit) return;
    const ids = selection.ids.length ? selection.ids : selection.caret ? [selection.caret] : [];
    const before = stream;
    const ops = moveLinesOps(before, ids, direction);
    if (ops.length === 0) return;
    try {
      const applied = applyOps(before, ops);
      commit(ops, applied.stream, before);
      lastAdoption = null;
      await session.flush();
      // The selection follows the moved words.
      if (api && ids.length) api.selectTokens(ids[0]!, ids[ids.length - 1]!);
    } catch {
      toasts.error(s.workspace.adoptFailed);
    }
  }

  /** Adopt the nth reading the band lists for the active variant, the edition's own left out. */
  function adoptNth(n: number) {
    if (!active) return;
    const segment = views[active.segmentId];
    const site = segment?.collation.sites.find((x) => x.index === active!.siteIndex);
    if (!segment || !site) return;
    const choice = variantOf(segment, site.index, variantContext)?.rows.filter((row) => row.origin)[
      n - 1
    ]?.origin;
    if (choice) void adopt(segment.segmentId, site, choice);
  }

  function pickWitnessWord(_segmentId: Id, tokenId: Id) {
    const word = witnessIdx.get(tokenId);
    if (!word) {
      toasts.info(s.workspace.agrees);
      return;
    }
    void adopt(word.segmentId, word.site, { kind: 'reading', reading: word.reading }, word.textId);
  }

  // Reviewing

  async function setReviewed(segmentId: Id, site: Site, flag: boolean) {
    const segment = views[segmentId];
    if (!segment) return;
    const key = keyOfSite(segment, site);
    // Kept under the segment the variant stands in; taken back from whichever segment of the passage holds it.
    const at = flag
      ? standsIn(segment, site.index)
      : (segment.segments.find((x) => (reviewed[x.segmentId] ?? []).includes(key))?.segmentId ??
        standsIn(segment, site.index));
    await setReviewedKey(at, key, flag);
  }

  async function setReviewedKey(segmentId: Id, key: string, flag: boolean) {
    const response = await fetch(`/api/editions/${editionId}/reviews`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ segmentId, siteKey: key, reviewed: flag }),
    });
    if (!response.ok) return;
    const keys = new Set(reviewed[segmentId] ?? []);
    if (flag) keys.add(key);
    else keys.delete(key);
    reviewed = { ...reviewed, [segmentId]: [...keys] };
  }

  /** Call a site textual or interpretative; back to what the letters say when the editor had set it otherwise. */
  async function setKind(segmentId: Id, site: Site) {
    const segment = views[segmentId];
    if (!segment) return;
    const kind: SiteKind = site.kind === 'textual' ? 'interpretative' : 'textual';
    const response = await fetch(`/api/editions/${editionId}/site-kinds`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        segmentId: standsIn(segment, site.index),
        siteKey: keyOfSite(segment, site),
        kind: site.kindByEditor ? null : kind,
      }),
    });
    if (!response.ok) return;
    const current = views[segmentId];
    if (!current) return;
    const sites = current.collation.sites.map((x) =>
      x.index === site.index ? { ...x, kind, kindByEditor: !site.kindByEditor } : x,
    );
    views = { ...views, [segmentId]: { ...current, collation: { ...current.collation, sites } } };
  }

  /** Judge a variant minor, or not; its kind is as it was. A minor variant is no longer marked in the text nor counted among those left to review. */
  async function setMinor(segmentId: Id, site: Site) {
    const segment = views[segmentId];
    if (!segment) return;
    const minor = !site.minor;
    const response = await fetch(`/api/editions/${editionId}/site-kinds`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        segmentId: standsIn(segment, site.index),
        siteKey: keyOfSite(segment, site),
        minor,
      }),
    });
    if (!response.ok) return;
    const current = views[segmentId];
    if (!current) return;
    const sites = current.collation.sites.map((x) => {
      if (x.index !== site.index) return x;
      const { minor: _was, ...rest } = x;
      return minor ? { ...rest, minor } : rest;
    });
    const next = { ...current, collation: { ...current.collation, sites } };
    views = { ...views, [segmentId]: next };
    outlines = { ...outlines, [segmentId]: outlineOf(next) };
  }

  // Conjectures

  let conjectureOpen = $state(false);
  let conjectureDraft = $state.raw<ConjectureDraft | null>(null);
  let conjectureBusy = $state(false);
  /** Where a conjecture is registered: its passage, the segment it names, the site and the words it is anchored to. */
  let conjectureTarget: { passage: Id; segmentId: Id; site: Site; anchor: Id[] } | null = null;

  function openConjecture(segmentId?: Id, site?: Site) {
    if (!canEdit) return;
    let segment: SegmentViewClient | undefined;
    let target: Site | null = null;
    let named: Id | null = null;
    if (segmentId && site) {
      segment = views[segmentId];
      target = site;
    } else if (active) {
      segment = views[active.segmentId];
      target = segment?.collation.sites.find((x) => x.index === active!.siteIndex) ?? null;
    } else {
      const anchor = selection.caret ?? selection.ids[0] ?? null;
      const id = anchor ? segmentOfItem(stream, anchor) : caretSegment;
      segment = viewOf(id);
      named = id;
      if (segment)
        target = selection.ids.length
          ? siteForTokens(segment, selection.ids)
          : insertionSite(segment, selection.caret);
    }
    if (!segment || !target) return;
    if (isStale(segment)) {
      toasts.info(s.workspace.stillSaving);
      return;
    }
    // The segment the conjecture names: the one its words begin in, or the one the variant is.
    const firstWord = siteTokenIds(target, segment.baseUnits)[0];
    const segmentOfTarget =
      (target.index >= 0 ? unprintedAt(segment, target.index)?.segmentId : undefined) ??
      (target.index >= 0 ? standsIn(segment, target.index) : undefined) ??
      (firstWord ? segmentOfItem(stream, firstWord) : null) ??
      named ??
      segment.segmentId;
    let lemma = segment.baseUnits
      .slice(target.baseFrom, target.baseTo)
      .map((u) => u.text)
      .join(' ');
    let reading = '';
    const anchor = siteTokenIds(target, segment.baseUnits);
    // Words the editor typed are an emendation already in the text: register it as what it is,
    // a reading proposed against what the witnesses have.
    const typed =
      anchor.length > 0 &&
      anchor.every((id) => {
        const item = stream.items.find((i) => i.id === id);
        return item?.kind === 'token' && (!item.source || item.source.kind === 'editor');
      });
    if (typed) {
      const witnessed = target.readings.find((r) => !r.base && !r.omission && r.text !== '');
      reading = lemma;
      lemma = witnessed?.text ?? lemma;
    }
    conjectureTarget = {
      passage: segment.segmentId,
      segmentId: segmentOfTarget,
      site: target,
      anchor,
    };
    conjectureDraft = {
      segmentLabel: labelOf[segmentOfTarget] ?? segment.label,
      lemma,
      kind: lemma ? 'substitution' : 'addition',
      reading,
      proposer: userName,
      note: '',
      extent: '',
      citations: [],
    };
    conjectureOpen = true;
  }

  async function submitConjecture(draft: ConjectureDraft, adoptIt: boolean) {
    const target = conjectureTarget;
    if (!target) return;
    conjectureBusy = true;
    try {
      const response = await fetch(`/api/editions/${editionId}/conjectures`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          segmentId: target.segmentId,
          kind: draft.kind,
          lemma: draft.lemma,
          reading: draft.reading,
          proposer: draft.proposer || null,
          note: draft.note || null,
          extent: draft.extent || null,
          anchorTokenIds: target.anchor,
          citations: draft.citations.map((c) => ({
            itemId: c.itemId,
            prenote: c.prenote || null,
            postnote: c.postnote || null,
          })),
          adopt: adoptIt,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const { conjecture } = (await response.json()) as { conjecture: { id: Id } };
      conjectureOpen = false;
      refocus();
      const segment = views[target.passage];
      if (adoptIt && segment) {
        // A lacuna is posited after the words, not instead of them.
        const site =
          draft.kind === 'lacuna' && target.anchor.length
            ? insertionSite(segment, target.anchor[target.anchor.length - 1]!)
            : target.site;
        const attachment: Attachment = {
          kind: 'conjecture',
          id: conjecture.id,
          text: draft.reading,
          name: draft.proposer || userName,
          conjectureKind: draft.kind,
        };
        const before = stream;
        const ops = opsForAttachment(
          before,
          segment,
          site,
          attachment,
          target.segmentId,
          lineation,
        );
        const applied = applyOps(before, ops);
        reviewAfter.push({
          segmentId: target.segmentId,
          ids: insertedIds(ops).concat(draft.kind === 'deletion' ? target.anchor : []),
          before: tokenBefore(target.anchor, segment, site),
        });
        commit(ops, applied.stream, before);
        lastAdoption = {
          reverse: applied.reverse,
          label: labelOf[target.segmentId] ?? segment.label,
        };
        await session.flush();
      } else {
        stale = new Set([...stale, target.segmentId]);
        void refreshStale();
      }
    } catch {
      toasts.error(s.workspace.adoptFailed);
    } finally {
      conjectureBusy = false;
    }
  }

  // Segments

  let segmentOpen = $state(false);
  let segmentInitial = $state('');
  let segmentHasStart = $state(false);
  let segmentError = $state<string | null>(null);
  let segmentBusy = $state(false);
  let segmentToken: Id | null = null;

  async function loadScheme(): Promise<Scheme | null> {
    if (scheme) return scheme;
    const response = await fetch(`/api/works/${workId}/segments`);
    if (!response.ok) return null;
    scheme = ((await response.json()) as { scheme: Scheme }).scheme;
    return scheme;
  }

  async function requestSegment(tokenId: Id, current: string | null) {
    if (!canEdit) return;
    segmentToken = tokenId;
    const index = stream.items.findIndex((item) => item.id === tokenId);
    const item = stream.items[index];
    segmentHasStart = !!(item && item.kind !== 'break' && item.segment);
    let proposal = current ?? '';
    if (!proposal) {
      const known = await loadScheme();
      for (let i = index - 1; i >= 0 && known; i--) {
        const previous = stream.items[i]!;
        if (previous.kind !== 'break' && previous.segment?.segmentId) {
          proposal = nextLabel(known, labelOf[previous.segment.segmentId] ?? '') ?? '';
          break;
        }
      }
    }
    segmentInitial = proposal;
    segmentError = null;
    segmentOpen = true;
  }

  async function submitSegment(label: string) {
    const tokenId = segmentToken;
    if (!tokenId) return;
    segmentBusy = true;
    segmentError = null;
    try {
      const response = await fetch(`/api/works/${workId}/segments`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ label }),
      });
      if (!response.ok) {
        segmentError =
          ((await response.json().catch(() => ({}))) as { message?: string }).message ??
          response.statusText;
        return;
      }
      const { segments } = (await response.json()) as { segments: { id: Id; label: string }[] };
      const segment = segments[0]!;
      labelOf = { ...labelOf, [segment.id]: segment.label };
      const ops: Op[] = [{ t: 'set', id: tokenId, fields: { segment: { segmentId: segment.id } } }];
      const before = stream;
      commit(ops, applyOps(before, ops).stream, before);
      segmentOpen = false;
      refocus();
      await session.flush();
    } finally {
      segmentBusy = false;
    }
  }

  async function removeSegmentStart() {
    const tokenId = segmentToken;
    if (!tokenId) return;
    const ops: Op[] = [{ t: 'set', id: tokenId, fields: { segment: undefined } }];
    const before = stream;
    commit(ops, applyOps(before, ops).stream, before);
    segmentOpen = false;
    await session.flush();
  }

  // Notes

  let noteOpen = $state(false);
  let noteSegment = $state<Id | null>(null);
  let noteBusy = $state(false);

  async function submitNote(text: string, citations: CitationDraft[]) {
    const segmentId = noteSegment;
    if (!segmentId) return;
    noteBusy = true;
    try {
      const tokenIds = selection.ids.filter((id) => segmentOfItem(stream, id) === segmentId);
      const cited = citations.map((c) => ({
        itemId: c.itemId,
        prenote: c.prenote || null,
        postnote: c.postnote || null,
      }));
      const response = await fetch(`/api/editions/${editionId}/notes`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ segmentId, tokenIds, text, citations: cited }),
      });
      if (!response.ok) throw new Error(response.statusText);
      const { note } = (await response.json()) as { note: SegmentViewClient['notes'][number] };
      const cites = citations.map((c) => formatCitation(c.label, c.prenote, c.postnote));
      const segment = viewOf(segmentId);
      if (segment)
        views = {
          ...views,
          [segment.segmentId]: {
            ...segment,
            notes: [...segment.notes, { ...note, segmentId, cites }],
          },
        };
      noteOpen = false;
    } catch {
      toasts.error(s.workspace.saveError(''));
    } finally {
      noteBusy = false;
    }
  }

  async function deleteNote(segmentId: Id, noteId: Id) {
    const response = await fetch(`/api/editions/${editionId}/notes`, {
      method: 'DELETE',
      headers: json,
      body: JSON.stringify({ id: noteId }),
    });
    if (!response.ok) return;
    const segment = viewOf(segmentId);
    if (segment)
      views = {
        ...views,
        [segment.segmentId]: { ...segment, notes: segment.notes.filter((n) => n.id !== noteId) },
      };
  }

  // Inserting objects at the caret

  let objectOpen = $state(false);
  let objectKind = $state<InsertKind>('speaker');

  function openInsert(kind: InsertKind) {
    if (!canEdit) return;
    objectKind = kind;
    objectOpen = true;
  }

  function insertObject(kind: InsertKind, text: string) {
    objectOpen = false;
    if (!api) return;
    if (kind === 'lacuna') api.insertObject('lacuna', text ? { extent: text } : {});
    else if (kind === 'margin') api.insertObject('paratext', { type: 'margin' }, text);
    else api.insertObject('paratext', { type: kind }, text);
    refocus();
  }

  /** Back to the text once a dialog has closed and handed focus back to its trigger. */
  function refocus() {
    setTimeout(() => api?.focus(), 250);
  }

  // Keyboard: Alt with arrows, digits and letters, caught before the editor's own Alt bindings.

  function onKey(event: KeyboardEvent) {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    let handled = true;
    if (event.shiftKey && canEdit && event.key === 'ArrowUp') void moveLines(-1);
    else if (event.shiftKey && canEdit && event.key === 'ArrowDown') void moveLines(1);
    else if (event.key === 'ArrowDown') step(1, false);
    else if (event.key === 'ArrowUp') step(-1, false);
    else if (event.code === 'KeyN') step(1, true);
    else if (canEdit && /^Digit[1-9]$/.test(event.code)) adoptNth(Number(event.code.slice(5)));
    else if (canEdit && event.code === 'KeyK' && active) {
      const site = views[active.segmentId]?.collation.sites.find(
        (x) => x.index === active!.siteIndex,
      );
      if (site) void setReviewed(active.segmentId, site, true);
    } else if (canEdit && event.code === 'KeyC') openConjecture();
    else if (canEdit && event.code === 'KeyI') openInsert('speaker');
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onBeforeUnload(event: BeforeUnloadEvent) {
    if (session.state.pending > 0 || session.state.saving) event.preventDefault();
  }

  // Segments come as the window reaches them, and the outline of the whole text once the editor is open.
  $effect(() => {
    void windowIds;
    untrack(() => void ensureShown());
  });
  onMount(() => {
    void loadOutline();
  });

  onMount(() => {
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
      void session.flush().finally(() => session.close());
    };
  });

  // The panes the editor can resize: the side pane's width, the apparatus band's height.
  let workspaceEl = $state<HTMLElement | null>(null);
  let upperEl = $state<HTMLElement | null>(null);
  const sidePane = new PaneSize('edition.side', { min: 260, max: 1000, fallback: 384 });
  const band = new PaneSize('edition.band', {
    min: 96,
    max: 2000,
    fallback: 300,
    initial: () => window.innerHeight * 0.34,
  });
  onMount(() => {
    sidePane.restore();
    band.restore();
  });

  // The floating marks under a selection

  let editorColumn = $state<HTMLElement | null>(null);
  /** Bumped when a pointer or key is released over the text: the selection may have grown without a new word in it. */
  let selectionTick = $state(0);
  const toolbarAt = $derived.by(() => {
    void selection;
    void selectionTick;
    if (
      !canEdit ||
      !api ||
      selection.ids.length === 0 ||
      !editorColumn ||
      conjectureOpen ||
      noteOpen ||
      segmentOpen ||
      objectOpen
    )
      return null;
    const rect = api.selectionRect();
    if (!rect) return null;
    const box = editorColumn.getBoundingClientRect();
    return {
      top: rect.bottom - box.top + 6,
      left: Math.max(8, Math.min(rect.left - box.left, box.width - 360)),
    };
  });

  function mark(kind: string) {
    api?.toggleMark(kind);
  }

  // The Paragraph menu offers the kind the paragraphs of the selection are not.
  let paragraphMenuOpen = $state(false);
  let kindAtSelection = $state<Lineation | null>(null);
  $effect(() => {
    if (paragraphMenuOpen) kindAtSelection = api?.lineationAtSelection() ?? null;
  });

  // The side pane: witnesses, and the history, whose panel loads when first opened.

  let HistoryPanel = $state<
    typeof import('$lib/components/history/HistoryPanel.svelte').default | null
  >(null);
  $effect(() => {
    if (side === 'history' && !HistoryPanel) {
      import('$lib/components/history/HistoryPanel.svelte').then((module) => {
        HistoryPanel = module.default;
      });
    }
  });
  const sideTabs: Tab[] = [
    { value: 'witnesses', label: s.workspace.witnesses },
    { value: 'history', label: s.workspace.history },
  ];

  async function onHistoryChanged() {
    // A revert or an undo made a new changeset on the server: start again from it.
    await session.flush();
    location.reload();
  }
</script>

<div
  class="workspace grid h-[calc(100dvh-3.5rem)] grid-rows-[minmax(0,1fr)_auto_auto] bg-page"
  bind:this={workspaceEl}
  style:--side-pane="{sidePane.value}px"
  style:--band="{band.value}px"
>
  <div
    class="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto_min(var(--side-pane),60%)]"
    bind:this={upperEl}
  >
    <div
      class="relative flex min-h-0 flex-col"
      bind:this={editorColumn}
      onpointerup={() => setTimeout(() => selectionTick++, 0)}
      onkeyup={() => selectionTick++}
      role="presentation"
    >
      {#if canEdit}
        <!-- A row of its own above the text: prose runs to the right edge, where menus laid over the text would cover it. -->
        <div class="flex shrink-0 items-center justify-end gap-1 px-3 pt-2">
          <Menu
            bind:open={paragraphMenuOpen}
            label={s.dialogs.paragraph.menu}
            triggerVariant="ghost"
            triggerSize="sm"
            align="end"
          >
            {#snippet trigger()}{s.dialogs.paragraph.menu}{/snippet}
            <MenuItem
              disabled={kindAtSelection === 'verse'}
              onSelect={() => api?.setLineation('verse')}>{s.dialogs.paragraph.verse}</MenuItem
            >
            <MenuItem
              disabled={kindAtSelection === 'prose'}
              onSelect={() => api?.setLineation('prose')}>{s.dialogs.paragraph.prose}</MenuItem
            >
            <MenuSeparator />
            <MenuItem onSelect={() => api?.newParagraph()}>{s.dialogs.paragraph.begin}</MenuItem>
          </Menu>
          <Menu label={s.dialogs.insert.menu} triggerVariant="ghost" triggerSize="sm" align="end">
            {#snippet trigger()}{s.dialogs.insert.menu}{/snippet}
            <MenuItem onSelect={() => openInsert('speaker')}>{s.dialogs.insert.speaker}…</MenuItem>
            <MenuItem onSelect={() => openInsert('head')}>{s.dialogs.insert.head}…</MenuItem>
            <MenuItem onSelect={() => openInsert('stage')}>{s.dialogs.insert.stage}…</MenuItem>
            <MenuItem onSelect={() => openInsert('margin')}>{s.dialogs.insert.margin}…</MenuItem>
            <MenuItem onSelect={() => openInsert('lacuna')}>{s.dialogs.insert.lacuna}…</MenuItem>
            <MenuItem onSelect={() => openConjecture()}>{s.dialogs.insert.conjecture}</MenuItem>
          </Menu>
        </div>
      {/if}
      <TextEditor
        {stream}
        form="written"
        readonly={!canEdit}
        lineNumbers={false}
        {lineation}
        segmentLabels={labelOf}
        {tokenClasses}
        {marginMarks}
        onmarginmark={(key) => void openUnprinted(key)}
        onops={onEditorOps}
        onselection={onSelection}
        onrequestsegment={(id, current) => void requestSegment(id, current)}
        bind:api
        class="min-h-0 flex-1 px-2"
      />
      {#if toolbarAt}
        <div
          class="absolute z-20 flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-1 font-sans text-xs shadow-pop"
          style={`top:${toolbarAt.top}px;left:${toolbarAt.left}px`}
          role="toolbar"
          aria-label={s.dialogs.insert.marks}
        >
          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-sunken"
            onpointerdown={(e) => e.preventDefault()}
            onclick={() => mark('supplied')}>{s.workspace.supplied}</button
          >
          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-sunken"
            onpointerdown={(e) => e.preventDefault()}
            onclick={() => mark('surplus')}>{s.workspace.deleted}</button
          >
          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-sunken"
            onpointerdown={(e) => e.preventDefault()}
            onclick={() => mark('crux')}>{s.workspace.crux}</button
          >
          <span class="mx-1 h-4 w-px bg-line"></span>
          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-sunken"
            title="Alt+Shift+↑"
            onpointerdown={(e) => e.preventDefault()}
            onclick={() => void moveLines(-1)}>{s.workspace.lineUp}</button
          >
          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-sunken"
            title="Alt+Shift+↓"
            onpointerdown={(e) => e.preventDefault()}
            onclick={() => void moveLines(1)}>{s.workspace.lineDown}</button
          >
          <span class="mx-1 h-4 w-px bg-line"></span>
          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-sunken"
            onpointerdown={(e) => e.preventDefault()}
            onclick={() => openConjecture()}>{s.register}</button
          >
          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-sunken"
            onpointerdown={(e) => e.preventDefault()}
            onclick={() => {
              const id = selection.ids[0] ? segmentOfItem(stream, selection.ids[0]) : null;
              if (id) {
                noteSegment = id;
                noteOpen = true;
              }
            }}>{s.note}</button
          >
        </div>
      {/if}
    </div>

    <Splitter
      class="hidden lg:block"
      pane={sidePane}
      axis="x"
      side="after"
      container={upperEl}
      label={s.workspace.resizeSide}
    />
    <aside class="hidden min-h-0 flex-col lg:flex">
      {#if sideTabs.length > 1}
        <div class="border-b border-line px-3 pt-2">
          <Tabs tabs={sideTabs} bind:value={side} label={s.workspace.witnesses} />
        </div>
      {/if}
      <div class="min-h-0 flex-1">
        {#if side === 'history' && HistoryPanel}
          <HistoryPanel
            kind="edition"
            documentId={editionId}
            currentVersion={lastVersion}
            {labelOf}
            {canEdit}
            onchanged={onHistoryChanged}
            numberEvery={view.edition.conventions.numberEvery}
            {lineation}
          />
        {:else}
          <WitnessPane
            {sigla}
            segmentIds={shownWithUnprinted}
            {labelOf}
            highlightTokenIds={witnessHighlight}
            bind:selected={witnessSiglum}
            bind:mode={witnessMode}
            onpick={pickWitnessWord}
          />
        {/if}
      </div>
    </aside>
  </div>

  <Splitter
    pane={band}
    axis="y"
    side="after"
    container={workspaceEl}
    label={s.workspace.resizeBand}
  />
  <section class="flex min-h-0 flex-col bg-surface" style:height="var(--band)">
    <div
      class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-1.5 font-sans text-xs text-ink-soft"
    >
      <span class="font-semibold text-ink">{s.apparatus}</span>
      <span
        >{!outlineReady
          ? s.workspace.counting
          : unreviewed === 0
            ? s.allReviewed
            : s.workspace.toReview(unreviewed, allSites)}</span
      >
      <span class="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onclick={() => step(-1, false)}
          title={s.workspace.previousSite}>‹</Button
        >
        <Button
          size="sm"
          variant="ghost"
          onclick={() => step(1, false)}
          title={s.workspace.nextSite}>›</Button
        >
        <Button
          size="sm"
          variant="secondary"
          disabled={!outlineReady || unreviewed === 0}
          onclick={() => step(1, true)}>{s.workspace.nextUnreviewed}</Button
        >
      </span>
      {#if lastAdoption}
        <Button size="sm" variant="ghost" onclick={undoAdoption}
          >{s.workspace.undoAdoption(lastAdoption.label)}</Button
        >
      {/if}
      <span class="ml-auto flex items-center gap-4">
        <Checkbox bind:checked={colourBySource}>{s.workspace.colourBySource}</Checkbox>
      </span>
    </div>
    <div class="min-h-0 flex-1">
      <ApparatusBand
        segmentIds={windowIds}
        segments={windowSegments}
        {active}
        {reviewed}
        {canEdit}
        context={variantContext}
        lang={view.work.language}
        busy={[...stale]}
        onadopt={(segmentId, site, choice) => void adopt(segmentId, site, choice)}
        onkeep={(segmentId, site, flag) => void setReviewed(segmentId, site, flag)}
        onkind={(segmentId, site) => void setKind(segmentId, site)}
        onminor={(segmentId, site) => void setMinor(segmentId, site)}
        onregister={(segmentId, site) => openConjecture(segmentId, site)}
        onfocus={(id, site) => (site ? focusSite(id, site) : focusLines(id))}
        onwitness={showWitness}
        onnote={(segmentId) => {
          noteSegment = segmentId;
          noteOpen = true;
        }}
        ondeletenote={(segmentId, noteId) => void deleteNote(segmentId, noteId)}
        ontakecurrent={takeCurrent}
      />
    </div>
    <p class="border-t border-line px-4 py-1 font-sans text-[0.7rem] text-ink-muted">
      {s.workspace.keys}
    </p>
  </section>
</div>

<ConjectureDialog
  bind:open={conjectureOpen}
  draft={conjectureDraft}
  busy={conjectureBusy}
  onsubmit={(draft, adoptIt) => void submitConjecture(draft, adoptIt)}
  oncancel={() => (conjectureOpen = false)}
/>
<SegmentDialog
  bind:open={segmentOpen}
  initial={segmentInitial}
  hasStart={segmentHasStart}
  error={segmentError}
  busy={segmentBusy}
  onsubmit={(label) => void submitSegment(label)}
  onremove={() => void removeSegmentStart()}
  oncancel={() => (segmentOpen = false)}
/>
<ObjectDialog
  bind:open={objectOpen}
  bind:kind={objectKind}
  oninsert={insertObject}
  oncancel={() => (objectOpen = false)}
/>
<NoteDialog
  bind:open={noteOpen}
  segmentLabel={noteSegment ? (labelOf[noteSegment] ?? '') : ''}
  busy={noteBusy}
  onsubmit={(text, citations) => void submitNote(text, citations)}
  oncancel={() => (noteOpen = false)}
/>

<style>
  .workspace :global(.vs-site) {
    text-decoration-line: underline;
    text-decoration-style: dotted;
    text-decoration-color: color-mix(in srgb, var(--color-accent) 70%, transparent);
    text-underline-offset: 0.22em;
    text-decoration-thickness: 1.5px;
  }
  .workspace :global(.vs-active) {
    background: var(--color-accent-soft);
    border-radius: 2px;
  }
  .workspace :global(.vs-conjecture) {
    color: var(--color-accent);
  }
  .workspace :global(.vs-editor) {
    color: var(--color-warning);
  }
  .workspace :global(.vs-drift) {
    text-decoration-line: underline;
    text-decoration-style: wavy;
    text-decoration-color: var(--color-warning);
    text-underline-offset: 0.25em;
  }
</style>
