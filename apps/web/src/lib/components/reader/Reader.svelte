<script lang="ts">
  /**
   * The reader of an edition: the critical text with labels
   * in the margin, words at variants marked with a dotted line, the points
   * between two words where a witness has words the edition has not marked
   * with a small caret, and in verse variants over whole segments marked in
   * the margin beside the lines (in prose they are marked in the text: on
   * the words, at the point, and on the labels), each opening the variant
   * window, the variants of the lines on screen, the witnesses and the facsimile in panels, search, and a print
   * stylesheet. The print apparatus is in the page for printing, for readers
   * without JavaScript, and on screen when the reader asks for it in the
   * gear (at the foot of each block or beside it). Server-rendered: the
   * settings are applied once the page is live, so that the first render
   * matches the server's.
   */
  import { onMount, untrack } from 'svelte';
  import { PageFrame } from '$lib/components/shell';
  import {
    blocksOf,
    inlineStarts,
    lineLabels,
    proseTokens,
    segmentOfItems,
    segmentsByLine,
    type Block,
  } from '$lib/reader/blocks';
  import { DEFAULT_SIGLA, printLine } from '$lib/reader/marks';
  import { findHits, searchIndex, type SearchHit, type SearchLine } from '$lib/reader/search';
  import { EditionText } from '$lib/reader/edition-text';
  import { orderVariantOf, variantOf, variantsOf, type VariantContext } from '$lib/reader/variant';
  import { mergePassages, passageIndex, passagesOf, unprintedAt } from '$lib/reader/passages';
  import { labelMarks, lineMarks } from '$lib/reader/line-marks';
  import {
    DEFAULT_SETTINGS,
    effectiveConventions,
    loadSettings,
    saveSettings,
    type ReaderSettings,
  } from '$lib/reader/settings';
  import {
    anyMinor,
    asPassage,
    entriesBySegment,
    entryBySite,
    listingMinor,
    markSites,
    orderKey,
    parseOrderKey,
    parseSiteKey,
    segmentParts,
    siteByToken,
    siglaOrderOf,
    siteOf,
    withMinor,
    witnessTokensAt,
  } from '$lib/reader/sites';
  import type { ReaderPageData, ReaderSegment } from '$lib/reader/types';
  import { reader as r } from '$lib/strings/reader';
  import { s } from '$lib/strings';
  import ApparatusBlock from './ApparatusBlock.svelte';
  import EntryPopover, { type PopoverEntry } from './EntryPopover.svelte';
  import FacsimilePanel from './FacsimilePanel.svelte';
  import ReaderBar from './ReaderBar.svelte';
  import DictionaryPanel from './DictionaryPanel.svelte';
  import { trimPunctuation } from '@varians/core';
  import ReaderColophon from './ReaderColophon.svelte';
  import ReaderHeading from './ReaderHeading.svelte';
  import TextLine from './TextLine.svelte';
  import VariantsPanel from './VariantsPanel.svelte';
  import WitnessPanel from './WitnessPanel.svelte';
  import { Splitter } from '$lib/components/ui';
  import { PaneSize } from '$lib/layout/pane-size.svelte';
  import { WitnessTexts } from './witness-texts.svelte';
  import { SegmentDetails } from './segment-details.svelte';
  import { unpackSegments, withDetail, type WireSegment, type WireText } from '$lib/reader/wire';

  interface Props {
    data: ReaderPageData;
  }

  let { data }: Props = $props();

  // The reader's settings: defaults on the server and in the first render, the stored ones once live.
  let settings = $state<ReaderSettings>({ ...DEFAULT_SETTINGS });
  let live = $state(false);

  // The passages of the segments the page was not sent when it opened, as they have come.
  let arrived = $state.raw<Record<string, ReaderSegment>>({});
  const sent = $derived(
    Object.keys(arrived).length > 0 ? mergePassages(data.segments, arrived) : data.segments,
  );
  /** What the page works with: a minor variant is in it, like any other, only when the reader asks for them. */
  const segments = $derived(withMinor(sent, settings.showMinor));
  /** The passage of each segment, by its first segment. */
  const passageOf = $derived(passageIndex(Object.values(sent).map(asPassage)));
  /** What belongs to each segment as a whole: its unplaced records and notes, and who is without its passage. */
  const parts = $derived(segmentParts(segments));

  // What the edition is: fixed for a page.
  const conventionsOfEdition = $derived(data.edition.conventions);
  const sigla = $derived(conventionsOfEdition.sigla ?? DEFAULT_SIGLA);
  const siglaOrder = $derived(siglaOrderOf(data.sigla));
  const printed = $derived(
    data.lines.map((line) => printLine(line.items, sigla, 'read', line.hyphen)),
  );
  const blocks = $derived(
    blocksOf(data.lines, { numberEvery: conventionsOfEdition.numberEvery ?? 5 }),
  );
  const segmentsOfLine = $derived(segmentsByLine(data.lines));
  const segmentOf = $derived(segmentOfItems(data.lines));
  /** The words of the paragraphs that are prose: variants over whole segments are marked on them, in the text. */
  const prose = $derived(proseTokens(data.lines));
  const sitesOfToken = $derived(siteByToken({ segments }, prose));
  const startsOfLine = $derived(
    data.lines.map((line) =>
      line.starts.flatMap((start) => (start.segmentId ? [start.segmentId] : [])),
    ),
  );
  /** The segments in the order of the text, with the sigla absent from each, for the conspectus. */
  const order = $derived(
    blocks
      .flatMap((block) => block.segmentIds)
      .map((id) => ({ label: data.labelOf[id] ?? id, absent: parts[id]?.absent ?? [] })),
  );
  const speakerDisplay = $derived(conventionsOfEdition.speakerDisplay ?? 'margin');
  const marginSpeakers = $derived(
    speakerDisplay === 'margin' &&
      data.lines.some((line) =>
        line.items.some(
          (item) =>
            item.kind === 'object' && item.type === 'paratext' && item.attrs?.type === 'speaker',
        ),
      ),
  );
  const hasLabels = $derived(data.lines.some((line) => line.starts.length > 0));
  const witnessesWithText = $derived(data.sigla.some((x) => x.transcriptionId));

  function storage(): Storage | undefined {
    try {
      return window.localStorage;
    } catch {
      return undefined;
    }
  }

  onMount(() => {
    settings = loadSettings(storage());
    panelsWidth.restore();
    live = true;
    // An address of a word (/id/<token>) arrives with ?word=<id>: the word is brought into view and marked.
    const word = new URL(location.href).searchParams.get('word');
    if (word) {
      requestAnimationFrame(() => {
        const element = document.querySelector<HTMLElement>(`[data-token="${CSS.escape(word)}"]`);
        element?.scrollIntoView({ block: 'center' });
        element?.classList.add('word-addressed');
      });
    }
  });

  // The panels' width on wide screens, which the divider at their edge changes.
  let readerBody = $state<HTMLElement | null>(null);
  const panelsWidth = new PaneSize('reader.panels', { min: 320, max: 960, fallback: 416 });

  $effect(() => {
    const current = { ...settings };
    if (live) untrack(() => saveSettings(storage(), current));
  });

  const sizes = { small: '1.0625rem', normal: 'var(--text-reading)', large: '1.375rem' } as const;
  const side = $derived(settings.apparatus === 'side');
  /** The print apparatus on screen; printing and pages without scripts always show it. */
  const apparatusOnScreen = $derived(settings.apparatus !== 'none');

  // The apparatus under the settings in force.
  const conventions = $derived(effectiveConventions(data.apparatus, settings));
  /** The print apparatus, which leaves a minor variant out as a printed edition does. */
  const printEntries = $derived(entriesBySegment(sent, conventions, siglaOrder));
  /** The entries that mark words, open in the popover and fill the list of variants: those of the print apparatus, and the minor variants when asked for. */
  const entries = $derived(
    settings.showMinor && anyMinor(sent)
      ? entriesBySegment(listingMinor(segments), conventions, siglaOrder)
      : printEntries,
  );
  const entryMap = $derived(entryBySite(entries));

  const marking = $derived(markSites(sitesOfToken, entryMap, segments, prose));
  /** The edition's words as it prints them, for the first row of a variant window. */
  const editionText = $derived(
    new EditionText(
      data.lines.flatMap((line) => line.items),
      sigla,
    ),
  );
  /** The edition's segments in the order of its text. */
  const segmentOrder = $derived(blocks.flatMap((block) => block.segmentIds));
  /** What a variant window reads: the conspectus, the edition's groups and its text, the labels of the segments and where witnesses order them otherwise. */
  const variantContext = $derived<VariantContext>({
    sigla: data.sigla,
    groups: conventionsOfEdition.groups,
    edition: editionText,
    labelOf: data.labelOf,
    order: segmentOrder,
    orders: data.orderVariants,
    passages: segments,
  });
  /** The marks in the margin of the lines of verse: for variants over whole segments. */
  const margin = $derived(
    lineMarks({
      segmentsOfLine,
      lineation: data.lines.map((line) => line.lineation),
      segments,
      shown: entryMap,
      orders: data.orderVariants,
      context: variantContext,
    }),
  );
  /** The labels in prose that mark the order of segments, in the margin and in the text. */
  const labelMark = $derived(labelMarks(data.lines, data.orderVariants));
  /** Whether two marks meet in the margin: the text then makes room for a second lane. */
  const marginLanes = $derived(
    [...margin.values()].some((parts) => parts.some((part) => part.lane > 0)),
  );
  /** The keys of the variants over the order of whole segments, which the reader always has. */
  const orderKeys = $derived(new Set(data.orderVariants.map((_, k) => orderKey(k))));

  const labels = $derived(lineLabels(data.lines, data.labelOf, settings.labels));
  /** Segments that begin within a line are labelled where they begin: in prose, or when every line is labelled. */
  const inlineLabels = $derived(
    inlineStarts(data.lines, data.labelOf, settings.labels === 'every'),
  );

  function segmentHref(label: string): string {
    return `${data.basePath}/${encodeURIComponent(label)}${data.query}`;
  }

  function blockHasApparatus(block: Block): boolean {
    return block.segmentIds.some(
      (id) =>
        (printEntries.get(id)?.length ?? 0) > 0 ||
        (parts[id]?.unplaced.length ?? 0) > 0 ||
        (parts[id]?.notes.length ?? 0) > 0,
    );
  }

  // The permalink's segment: scrolled to once the page is live, and lit for a moment (by CSS, so also without scripts).
  const focusSegment = $derived(
    data.focus && 'segmentId' in data.focus ? data.focus.segmentId : null,
  );
  const missingSegment = $derived(
    data.focus && 'missing' in data.focus ? data.focus.missing : null,
  );

  let textRoot = $state<HTMLElement | null>(null);
  let reading = $state<HTMLElement | null>(null);
  let firstScroll = true;

  $effect(() => {
    const id = focusSegment;
    if (!live || !id || !textRoot) return;
    untrack(() => {
      const line = textRoot?.querySelector<HTMLElement>(`[data-starts~="${CSS.escape(id)}"]`);
      line?.scrollIntoView({ block: 'start', behavior: firstScroll ? 'auto' : 'smooth' });
      firstScroll = false;
    });
  });

  // The header shows the title once the page's own has scrolled out of view.
  let titleInView = $state(true);
  $effect(() => {
    const title = reading?.querySelector('.title-block h1');
    if (!title) return;
    const observer = new IntersectionObserver(
      ([record]) => (titleInView = record?.isIntersecting ?? false),
      { rootMargin: '-48px 0px 0px 0px' },
    );
    observer.observe(title);
    return () => observer.disconnect();
  });

  // Panels.
  let variantsOpen = $state(false);
  let witnessOpen = $state(false);
  let facsimileOpen = $state(false);
  let dictionaryOpen = $state(false);
  /** The dictionary is offered for Greek texts. */
  const hasDictionary = $derived(['grc', 'el'].includes(data.work.language.split('-')[0] ?? ''));
  /** The word last clicked while the dictionary is open. */
  let lookedUp = $state<string | null>(null);
  const panelsOpen = $derived(variantsOpen || witnessOpen || facsimileOpen || dictionaryOpen);
  /** The normalized form of each edition word, for the dictionary. */
  const wordOf = $derived.by(() => {
    const out = new Map<string, string>();
    for (const line of data.lines)
      for (const item of line.items)
        if (item.kind === 'token') out.set(item.id, item.norm ?? item.form);
    return out;
  });
  let chosenSiglum = $state<string | null>(null);
  const siglum = $derived(
    chosenSiglum && data.sigla.some((x) => x.siglum === chosenSiglum)
      ? chosenSiglum
      : (data.sigla.find((x) => x.transcriptionId)?.siglum ?? data.sigla[0]?.siglum ?? null),
  );
  const transcriptionId = $derived(
    data.sigla.find((x) => x.siglum === siglum)?.transcriptionId ?? null,
  );
  const texts = new WitnessTexts();
  /** What the page was not sent of the segments, once asked for. */
  const details = new SegmentDetails();

  /** How many segments are asked for at once, of those the page was not sent. */
  const PENDING_CHUNK = 100;

  /** Ask for the places of the segments the page was not sent, nearest the one asked for first; they take their place in the text as they come. */
  async function fetchPending(ids: string[], url: string, baseId: string) {
    for (let i = 0; i < ids.length; i += PENDING_CHUNK) {
      const chunk = ids.slice(i, i + PENDING_CHUNK);
      try {
        const response = await fetch(
          `${url}${url.includes('?') ? '&' : '?'}segments=${encodeURIComponent(chunk.join(','))}`,
        );
        if (!response.ok) return;
        const wire = (await response.json()) as {
          segments: Record<string, WireSegment>;
          texts: WireText[];
        };
        arrived = { ...arrived, ...unpackSegments(wire.segments, wire.texts, baseId) };
      } catch {
        return;
      }
      // Each stretch that comes makes the apparatus again: the page takes a breath between.
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  $effect(() => {
    const ids = data.pending;
    const url = data.sites;
    const baseId = data.edition.id;
    if (!live || ids.length === 0) return;
    untrack(() => void fetchPending(ids, url, baseId));
  });

  /** A passage with its detail, when that has come: the words each text has at each place. */
  function fullSegment(id: string) {
    const segment = segments[id];
    const detail = details.get(data.detail, id);
    return segment && detail ? withDetail(segment, detail) : segment;
  }

  /** A witness's units over the segments of a passage, in the passage's order, as its alignment counts them. */
  function unitsOver(textId: string, passage: ReaderSegment | undefined) {
    if (!passage) return undefined;
    const out = [];
    for (const part of passage.segments) {
      const got = texts.get(textId, part.segmentId);
      if (!got) return undefined;
      out.push(...got.units);
    }
    return out;
  }

  // The segments on screen, while a panel needs them.
  let visibleSegments = $state<string[]>([]);
  $effect(() => {
    const root = textRoot;
    void data.lines;
    if (!panelsOpen || !root) return;
    const visible = new Set<number>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const ids: string[] = [];
      for (const index of [...visible].sort((a, b) => a - b)) {
        for (const id of segmentsOfLine[index] ?? []) if (!ids.includes(id)) ids.push(id);
      }
      visibleSegments = ids.slice(0, 60);
    };
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          const index = Number((record.target as HTMLElement).dataset.line);
          if (record.isIntersecting) visible.add(index);
          else visible.delete(index);
        }
        clearTimeout(timer);
        timer = setTimeout(update, 120);
      },
      { rootMargin: '-48px 0px 0px 0px' },
    );
    for (const element of root.querySelectorAll('[data-line]')) observer.observe(element);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  });

  // The open entry and the hovered one.
  let popoverOpen = $state(false);
  let popoverAnchor = $state<HTMLElement | null>(null);
  let activeKeys = $state<string[]>([]);
  let hoveredKeys = $state<string[]>([]);

  /** The words of the chosen witness at some sites. */
  function witnessTokens(keys: string[], textId: string | null): string[] {
    const ids: string[] = [];
    if (!textId) return ids;
    for (const key of keys) {
      const ref = parseSiteKey(key);
      if (!ref) continue;
      const segment = fullSegment(ref.segmentId);
      const fallback = {
        aligned: segment?.aligned?.[textId],
        units: unitsOver(textId, segment),
      };
      for (const id of witnessTokensAt(siteOf(segment, ref.siteIndex), textId, fallback))
        if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  const witnessLit = $derived(
    new Set(witnessTokens(hoveredKeys.length ? hoveredKeys : activeKeys, transcriptionId)),
  );
  const facsimileLit = $derived(witnessTokens(activeKeys, transcriptionId));

  // The panels light a witness's words at the places in view, which the page was not sent: they are asked for as the places come into view.
  $effect(() => {
    if (!panelsOpen) return;
    const ids = [
      ...[...activeKeys, ...hoveredKeys].flatMap((key) => parseSiteKey(key)?.segmentId ?? []),
      ...passagesOf(visibleSegments.slice(0, 40), passageOf),
    ];
    if (ids.length) untrack(() => void details.load(data.detail, ids));
  });

  // The witness's words of the open entry's segments, for the panels to light them.
  $effect(() => {
    const tid = transcriptionId;
    if (!panelsOpen || !tid || activeKeys.length === 0) return;
    // Every segment of the passages of the open entries: the witness's words of a variant may lie in any.
    const ids = activeKeys.flatMap((key) => {
      const passage = segments[parseSiteKey(key)?.segmentId ?? ''];
      return passage ? passage.segments.map((s) => s.segmentId) : [];
    });
    untrack(() => void texts.load(tid, ids));
  });

  const popoverEntries = $derived<PopoverEntry[]>(
    activeKeys.flatMap((key) => {
      const order = parseOrderKey(key);
      if (order !== null) {
        const variant = orderVariantOf(order, variantContext);
        return variant ? [{ key, label: variant.label, variant, permalink: null }] : [];
      }
      const ref = parseSiteKey(key);
      const segment = ref ? segments[ref.segmentId] : undefined;
      const variant =
        segment && entryMap.has(key) ? variantOf(segment, ref!.siteIndex, variantContext) : null;
      if (!variant) return [];
      // A segment the edition does not print is at no address of the edition's; another goes to its first segment.
      const permalink = unprintedAt(asPassage(segment!), ref!.siteIndex)
        ? null
        : segmentHref(data.labelOf[variant.stands] ?? variant.label);
      return [{ key, label: variant.label, variant, permalink }];
    }),
  );

  /** The variants of the lines on screen, with the segments the edition does not print that follow them, while the list of variants is open. */
  const variantGroups = $derived(
    variantsOpen ? variantsOf(visibleSegments, segments, entryMap, variantContext) : [],
  );

  /** Light the words and entries of some sites, by a data attribute the components style. */
  function mark(attribute: 'data-lit' | 'data-active', keys: string[]) {
    const root = reading;
    if (!root) return;
    for (const element of root.querySelectorAll(`[${attribute}]`))
      element.removeAttribute(attribute);
    for (const key of keys) {
      const value = CSS.escape(key);
      for (const element of root.querySelectorAll(
        `[data-sites~="${value}"], [data-site="${value}"]`,
      ))
        element.setAttribute(attribute, '');
    }
  }

  /** Where focus goes when the popover closes, when it was opened from somewhere other than its word. */
  let returnFocus: HTMLElement | null = null;

  /** Open the popover on a word: for all its sites, or for the ones given. */
  function openEntry(word: HTMLElement, only?: string[]) {
    const keys = (only ?? (word.dataset.sites ?? '').split(' ')).filter(
      (key) => entryMap.has(key) || orderKeys.has(key),
    );
    if (keys.length === 0) return;
    activeKeys = keys;
    popoverAnchor = word;
    popoverOpen = true;
    mark('data-active', keys);
  }

  /** From the list of variants: scroll to a place's words and open their popover; focus comes back to the list. */
  function openSite(key: string, from: HTMLElement) {
    const root = reading;
    if (!root) return;
    const value = CSS.escape(key);
    const word =
      root.querySelector<HTMLElement>(`[data-sites~="${value}"][tabindex="0"]`) ??
      root.querySelector<HTMLElement>(`[data-sites~="${value}"]`);
    if (!word) return;
    // Wide screens keep the panel beside the text; narrow ones have it as a sheet at the foot, so the words go to the top.
    const wide = window.matchMedia('(min-width: 64rem)').matches;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    (word.closest<HTMLElement>('[data-line]') ?? word).scrollIntoView({
      block: wide ? 'center' : 'start',
      behavior: still ? 'auto' : 'smooth',
    });
    openEntry(word, [key]);
    returnFocus = from;
  }

  /**
   * From a siglum of a variant window: the Witnesses panel on that witness,
   * with the variant's words lit (a siglum of no variant lights none).
   */
  function showWitness(witness: string, key: string) {
    chosenSiglum = witness;
    if (key) activeKeys = [key];
    witnessOpen = true;
    popoverOpen = false;
  }

  /** Light the words of some places from the list of variants. */
  function hoverSites(keys: string[]) {
    mark('data-lit', keys);
    hoveredKeys = keys;
  }

  $effect(() => {
    if (!popoverOpen) untrack(() => mark('data-active', []));
  });

  /** Focus back to the word, or to the first word of its site when the word itself takes no focus. */
  function focusAfterClose() {
    // Moving from one place to another can close and reopen the popover; focus then stays in it.
    if (popoverOpen) return;
    const back = returnFocus;
    returnFocus = null;
    if (back?.isConnected) {
      back.focus({ preventScroll: true });
      return;
    }
    const anchor = popoverAnchor;
    if (!anchor || !anchor.isConnected) return;
    if (anchor.tabIndex >= 0) anchor.focus({ preventScroll: true });
    else {
      const key = activeKeys[0];
      const stop = key
        ? reading?.querySelector<HTMLElement>(`[data-sites~="${CSS.escape(key)}"][tabindex="0"]`)
        : null;
      stop?.focus({ preventScroll: true });
    }
  }

  // Clicks, keys and hovering in the text and the apparatus, delegated from the reading column.
  $effect(() => {
    const root = reading;
    if (!root) return;
    const click = (event: MouseEvent) => {
      // With the dictionary open, any word is looked up.
      if (dictionaryOpen && !window.getSelection()?.toString()) {
        const any = (event.target as HTMLElement).closest<HTMLElement>('[data-token]');
        const text = any?.dataset.token ? wordOf.get(any.dataset.token) : undefined;
        if (text) lookedUp = trimPunctuation(text);
      }
      const word = (event.target as HTMLElement).closest<HTMLElement>('[data-sites]');
      if (!word || !root.contains(word)) return;
      // Selecting text is not opening an entry.
      if (window.getSelection()?.toString()) return;
      returnFocus = null;
      openEntry(word);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const word = (event.target as HTMLElement).closest<HTMLElement>('[data-sites]');
      if (!word) return;
      event.preventDefault();
      returnFocus = null;
      openEntry(word);
    };
    let hovered = '';
    const over = (event: PointerEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-sites], [data-site]',
      );
      const value = target ? (target.dataset.sites ?? target.dataset.site ?? '') : '';
      if (value === hovered) return;
      hovered = value;
      const keys = value ? value.split(' ') : [];
      mark('data-lit', keys);
      hoveredKeys = keys;
    };
    const leave = () => {
      hovered = '';
      mark('data-lit', []);
      hoveredKeys = [];
    };
    root.addEventListener('click', click);
    root.addEventListener('keydown', keydown);
    root.addEventListener('pointerover', over);
    root.addEventListener('pointerleave', leave);
    return () => {
      root.removeEventListener('click', click);
      root.removeEventListener('keydown', keydown);
      root.removeEventListener('pointerover', over);
      root.removeEventListener('pointerleave', leave);
    };
  });

  // Search.
  let query = $state('');
  let hits = $state<SearchHit[]>([]);
  let hitIndex = $state(0);
  let searchLines: SearchLine[] | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const hitLines = $derived(new Set(hits.map((hit) => hit.line)));
  const matchTokens = $derived(new Set(hits.flatMap((hit) => hit.tokenIds)));
  const currentHitLine = $derived(hits[hitIndex]?.line ?? null);

  function scrollToLine(index: number) {
    textRoot
      ?.querySelector<HTMLElement>(`[data-line="${index}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function runSearch(value: string) {
    searchLines ??= searchIndex(data.lines);
    hits = findHits(searchLines, value);
    hitIndex = 0;
    if (hits[0]) scrollToLine(hits[0].line);
  }

  function search(value: string) {
    query = value;
    clearTimeout(searchTimer);
    if (value.trim() === '') {
      hits = [];
      hitIndex = 0;
      return;
    }
    searchTimer = setTimeout(() => runSearch(value), 150);
  }

  function step(direction: 1 | -1) {
    if (hits.length === 0) return;
    hitIndex = (hitIndex + direction + hits.length) % hits.length;
    scrollToLine(hits[hitIndex]!.line);
  }

  // Another version or another edition starts afresh.
  $effect(() => {
    void data.edition.id;
    void data.basePath;
    void data.edition.version;
    untrack(() => {
      arrived = {};
      popoverOpen = false;
      activeKeys = [];
      hoveredKeys = [];
      searchLines = null;
      if (query.trim() !== '') runSearch(query);
    });
  });

  const authorAndWork = $derived(r.authorAndWork(data.work.author, data.work.title));
  const description = $derived(
    (data.edition.preface ?? '').trim().slice(0, 200) || `${authorAndWork}. ${data.edition.title}`,
  );
</script>

<svelte:head>
  <title>{data.edition.title} · {authorAndWork} · {s.app.name}</title>
  <meta name="description" content={description} />
  <!-- The header's tools need the page to be live; without scripts the text, the apparatus and the colophon remain. -->
  <!-- Without scripts no word can be opened, so the print apparatus shows under the text. -->
  <noscript>
    <style>
      :global(.word-addressed) {
        outline: 2px solid var(--color-accent, currentColor);
        outline-offset: 2px;
        border-radius: 2px;
      }
      .reader-bar-root {
        display: none !important;
      }
      .apparatus-wrap.apparatus-hidden {
        display: block !important;
      }
    </style></noscript
  >
</svelte:head>

<div class="reader" style:--reader-size={sizes[settings.size]}>
  <ReaderBar
    {data}
    {settings}
    onsettings={(next) => (settings = next)}
    {query}
    hits={hits.length}
    hit={hitIndex}
    onsearch={search}
    onstep={step}
    bind:variantsOpen
    bind:witnessOpen
    bind:facsimileOpen
    bind:dictionaryOpen
    {hasDictionary}
    showTitle={!titleInView}
  />

  <div
    class={['reader-body', panelsOpen && 'with-panels']}
    bind:this={readerBody}
    style:--panels-width="{panelsWidth.value}px"
  >
    <div class="reader-main" bind:this={reading}>
      <PageFrame width="reading" class={side ? 'max-w-[67rem]!' : undefined}>
        <ReaderHeading {data} {missingSegment} />

        <article
          class={[
            'text-root',
            side && 'side',
            marginSpeakers && 'margin-speakers',
            marginLanes && 'margin-lanes',
            !hasLabels && 'no-labels',
          ]}
          bind:this={textRoot}
          aria-label={r.text.label}
          lang={data.work.language}
        >
          {#each blocks as block (block.index)}
            <section class="block">
              <div class="lines">
                {#each data.lines.slice(block.from, block.to) as line, k (line.index)}
                  {@const i = block.from + k}
                  <TextLine
                    {line}
                    index={i}
                    pieces={printed[i] ?? []}
                    label={labels[i] ?? null}
                    labelHref={labels[i] ? segmentHref(labels[i]!) : null}
                    {speakerDisplay}
                    starts={startsOfLine[i] ?? []}
                    sitesOf={marking.keysOf}
                    marked={marking.marked}
                    tabStops={marking.tabStops}
                    pointsAfter={marking.after}
                    pointsBefore={marking.before}
                    margin={margin.get(i) ?? []}
                    labelKeys={labelMark.margin.get(i)}
                    labelStop={labelMark.stops.margin.has(i)}
                    inlineKeys={labelMark.inline}
                    inlineStops={labelMark.stops.inline}
                    underline={settings.underline}
                    interactive={live}
                    {inlineLabels}
                    {segmentOf}
                    {focusSegment}
                    focusLine={focusSegment !== null &&
                      segmentsOfLine[i]?.length === 1 &&
                      segmentsOfLine[i]![0] === focusSegment}
                    matches={matchTokens}
                    hit={hitLines.has(i)}
                    currentHit={currentHitLine === i}
                  />
                {/each}
              </div>
              {#if blockHasApparatus(block)}
                <div class={['apparatus-wrap', !apparatusOnScreen && 'apparatus-hidden']}>
                  <ApparatusBlock
                    segmentIds={block.segmentIds}
                    entries={printEntries}
                    segments={parts}
                    labelOf={data.labelOf}
                    {conventions}
                    {side}
                  />
                </div>
              {/if}
            </section>
          {:else}
            <p class="font-sans text-sm text-ink-muted">{r.text.empty}</p>
          {/each}
        </article>

        <ReaderColophon
          exports={data.exports}
          versions={data.versions}
          origin={data.origin}
          sources={data.edition.sources}
          licence={data.edition.licence}
          rightsNote={data.edition.rightsNote}
          cite={{
            title: data.edition.title,
            editors: data.edition.editors,
            slug: data.edition.slug,
            mode: data.mode,
          }}
        />
      </PageFrame>
    </div>

    {#if panelsOpen}
      <aside class="reader-panels" aria-label={r.panels.region}>
        <div class="panels-edge">
          <Splitter
            pane={panelsWidth}
            axis="x"
            side="after"
            container={readerBody}
            share={0.6}
            label={r.panels.resize}
          />
        </div>
        {#if variantsOpen}
          <VariantsPanel
            groups={variantGroups}
            onScreen={visibleSegments.length > 0}
            lang={data.work.language}
            active={popoverOpen ? activeKeys : []}
            onhover={hoverSites}
            onopen={openSite}
            onwitness={showWitness}
            onclose={() => (variantsOpen = false)}
          />
        {/if}
        {#if witnessOpen}
          <WitnessPanel
            sigla={data.sigla}
            groups={data.edition.conventions.groups}
            {order}
            {siglum}
            {texts}
            segmentIds={visibleSegments}
            labelOf={data.labelOf}
            lit={witnessLit}
            onselect={(value) => (chosenSiglum = value)}
            onclose={() => (witnessOpen = false)}
          />
        {/if}
        {#if dictionaryOpen}
          <DictionaryPanel word={lookedUp} onclose={() => (dictionaryOpen = false)} />
        {/if}
        {#if facsimileOpen}
          <FacsimilePanel
            sigla={data.sigla}
            {siglum}
            {texts}
            segmentIds={visibleSegments}
            lit={facsimileLit}
            onselect={(value) => (chosenSiglum = value)}
            onclose={() => (facsimileOpen = false)}
          />
        {/if}
      </aside>
    {/if}
  </div>

  <EntryPopover
    bind:open={popoverOpen}
    anchor={popoverAnchor}
    entries={popoverEntries}
    lang={data.work.language}
    witnesses={witnessesWithText}
    onwitness={() => {
      witnessOpen = true;
      popoverOpen = false;
    }}
    onfacsimile={() => {
      facsimileOpen = true;
      popoverOpen = false;
    }}
    onsiglum={showWitness}
    onopen={openSite}
    onclosed={focusAfterClose}
  />
</div>

<style>
  .reader {
    --reader-size: var(--text-reading);
    display: flex;
    flex: 1;
    flex-direction: column;
  }

  .reader-body {
    display: flex;
    align-items: flex-start;
    width: 100%;
  }

  .reader-main {
    min-width: 0;
    flex: 1;
  }

  /* The text: serif at the reading size, labels in a margin column on the start side. */
  .text-root {
    --label-column: calc(2.75rem + var(--marks-room, 0rem));
    container-type: inline-size;
    font-family: var(--font-serif);
    font-size: var(--reader-size);
    line-height: 1.65;
    color: var(--color-ink);
  }

  .text-root.no-labels {
    --label-column: 0rem;
  }

  .text-root.margin-speakers {
    --speaker-column: 5.5rem;
  }

  /* A second lane of marks in the margin before the words. */
  .text-root.margin-lanes {
    --marks-room: 0.65rem;
  }

  @media (min-width: 40rem) {
    .text-root {
      --label-column: calc(3.5rem + var(--marks-room, 0rem));
    }
  }

  .block + .block {
    margin-top: 0.4em;
  }

  /* The print apparatus, when the reader has not asked for it on screen. */
  .apparatus-hidden {
    display: none;
  }

  /* The apparatus beside the text, where the column is wide enough. */
  @container (min-width: 50rem) {
    .side .block {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 17rem;
      column-gap: 2rem;
      align-items: start;
    }

    .side .block + .block {
      margin-top: 1em;
    }
  }

  /* Panels: a column on the right on wide screens, a sheet at the foot on narrow ones. */
  /* The divider on the panels' left edge, where the panels stand beside the text. */
  .panels-edge {
    position: absolute;
    top: 1.5rem;
    bottom: 1.5rem;
    left: 0;
    display: none;
  }

  .reader-panels {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 40;
    display: flex;
    max-height: 62dvh;
    flex-direction: column;
    gap: 0.75rem;
    overflow-y: auto;
    border-top: 1px solid var(--color-line);
    background: var(--color-page);
    padding: 0.75rem;
    box-shadow: 0 -10px 30px -12px rgb(20 18 14 / 0.25);
  }

  .with-panels .reader-main {
    padding-bottom: 62dvh;
  }

  @media (min-width: 64rem) {
    .reader-panels {
      position: sticky;
      top: 3rem;
      bottom: auto;
      z-index: auto;
      width: min(var(--panels-width, 26rem), 60vw);
      max-height: calc(100dvh - 3rem);
      flex-shrink: 0;
      border-top: 0;
      background: none;
      padding: 1.5rem 1.5rem 1.5rem 0.75rem;
      box-shadow: none;
    }

    .panels-edge {
      display: flex;
    }

    .with-panels .reader-main {
      padding-bottom: 0;
    }
  }

  /* Print: the text with the apparatus under each block and the labels in the margin; nothing of the interface. */
  @media print {
    :global(:root) {
      --color-page: #fff !important;
      --color-surface: #fff !important;
      --color-ink: #000 !important;
      --color-ink-soft: #1a1a1a !important;
      --color-ink-muted: #333 !important;
      --color-line: #888 !important;
    }

    :global(header:has(+ main#main)) {
      display: none !important;
    }

    .reader-panels {
      display: none !important;
    }

    .with-panels .reader-main {
      padding-bottom: 0;
    }

    .reader :global(.mx-auto) {
      max-width: none;
      padding: 0;
    }

    .text-root {
      --label-column: 2.6rem;
      font-size: 11.5pt;
      line-height: 1.45;
    }

    .side .block {
      display: block;
    }

    .apparatus-hidden {
      display: block;
    }
  }

  @page {
    margin: 18mm 16mm 20mm;
  }
</style>
