<script lang="ts">
  /**
   * The history panel of both editors (PLAN 4.11, 6.2, 6.3). Self-contained:
   * given a document it fetches its own data.
   *
   * Moments: the history newest first, as sessions (one person's work before
   * a pause: who, when, how much changed) and named moments, the beginning at
   * the bottom. Opening one shows the text as it stood, with what changed
   * since the moment before marked in the colour of who changed it; from
   * there a moment can be named and the text brought back as it was. Each
   * change of a session can be undone on its own.
   *
   * Review: the changes of others since the reviewer's review point, to
   * accept, reject or leave for later.
   *
   * After the text was brought back or a change undone the host is told
   * (onchanged) so that it reloads the document; the panel reloads itself
   * whenever currentVersion moves.
   */
  import { tick, untrack } from 'svelte';
  import Bookmark from '@lucide/svelte/icons/bookmark';
  import BookmarkCheck from '@lucide/svelte/icons/bookmark-check';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import { Button, Notice, Spinner, TabPanel, Tabs, toasts, type Tab } from '$lib/components/ui';
  import { assignSlots, authorSlot } from '$lib/history/colors';
  import { describeCounts } from '$lib/history/summary';
  import { formatMoment, formatSpan, formatTime } from '$lib/history/time';
  import { buildTimeline, type TimelineEntry } from '$lib/history/timeline';
  import type { DocumentHistory, DocumentKind, HistoryChangeset, ReviewItem } from '$lib/history/types';
  import { historyStrings as t } from '$lib/strings/history';
  import { HistoryRequestError, historyApi } from './api';
  import MomentView from './MomentView.svelte';
  import ReviewPanel from './ReviewPanel.svelte';
  import './palette.css';

  interface Props {
    kind: DocumentKind;
    documentId: string;
    /** The document's version as the host holds it; the panel reloads when it moves. */
    currentVersion: number;
    /** Segment id to label, for the gutter of the texts shown. */
    labelOf: Record<string, string>;
    /** Whether the user may edit: naming, bringing back, undoing and reviewing. */
    canEdit: boolean;
    /** Called after the text was brought back or a change undone, so that the host reloads the document. */
    onchanged?: () => void;
    /** Print a label every n lines (verse). */
    numberEvery?: number;
  }

  let { kind, documentId, currentVersion, labelOf, canEdit, onchanged, numberEvery = 1 }: Props = $props();

  const uid = $props.id();
  const api = $derived(historyApi(kind, documentId));
  let root = $state<HTMLElement>();

  const tabs: Tab[] = [
    { value: 'moments', label: t.tabs.moments },
    { value: 'review', label: t.tabs.review },
  ];
  let tab = $state('moments');
  let reviewOpened = $state(false);
  $effect(() => {
    if (tab === 'review') reviewOpened = true;
  });

  // The history, loaded on mount, for another document, and when the version moves.

  let history = $state.raw<DocumentHistory | null>(null);
  let loading = $state(true);
  let failure = $state<string | null>(null);
  let request = 0;

  async function load() {
    const mine = ++request;
    failure = null;
    try {
      const result = await api.history();
      if (mine === request) history = result;
    } catch (cause) {
      if (mine === request) failure = cause instanceof HistoryRequestError && cause.status === 0 ? t.offline : t.failed;
    } finally {
      if (mine === request) loading = false;
    }
  }

  let shownDocument = '';
  $effect(() => {
    const shown = `${kind}/${documentId}`;
    const version = currentVersion;
    const fresh = shown !== shownDocument;
    if (fresh) {
      shownDocument = shown;
      untrack(() => {
        history = null;
        opened = null;
        loading = true;
      });
    } else if (untrack(() => history?.currentVersion === version)) return;
    const timer = setTimeout(() => void load(), fresh ? 0 : 400);
    return () => clearTimeout(timer);
  });

  const timeline = $derived(history ? buildTimeline(history.sessions, history.moments) : []);

  // Colours: one slot per person of the document, kept apart where the palette allows.
  const slots = $derived(assignSlots(Object.keys(history?.people ?? {})));
  function colorOf(userId: string | null): string {
    if (!userId) return 'var(--author-none)';
    return `var(--author-${slots.get(userId) ?? authorSlot(userId)})`;
  }
  function nameOf(userId: string | null): string {
    return (userId && history?.people[userId]) || t.unknownPerson;
  }

  // Opening a moment.

  interface Opened {
    key: string;
    version: number;
    since: number;
    title: string;
  }
  let opened = $state<Opened | null>(null);
  let returnTo = '';

  function open(target: Opened) {
    returnTo = target.key;
    opened = target;
  }

  function openEntry(entry: TimelineEntry) {
    open({
      key: entry.key,
      version: entry.version,
      since: entry.since,
      title: entry.type === 'session' ? `${entry.session.userName}, ${formatSpan(entry.session.from, entry.session.to, t)}` : entry.moment.name,
    });
  }

  function openChangeset(changeset: HistoryChangeset) {
    open({ key: `c${changeset.id}`, version: changeset.version, since: changeset.version - 1, title: `${nameOf(changeset.userId)}, ${formatMoment(changeset.at, t)}` });
  }

  function showInText(item: ReviewItem) {
    tab = 'moments';
    open({ key: `c${item.id}`, version: item.version, since: item.version - 1, title: `${item.userName}, ${formatMoment(item.at, t)}` });
  }

  async function back() {
    opened = null;
    await tick();
    root?.querySelector<HTMLElement>(`[data-history-entry="${returnTo}"]`)?.focus();
  }

  async function nameVersion(version: number, name: string): Promise<boolean> {
    try {
      await api.nameMoment(version, name);
      toasts.success(t.named(name));
      await load();
      return true;
    } catch {
      toasts.error(t.nameFailed);
      return false;
    }
  }

  async function bringBack(version: number) {
    try {
      const result = await api.revert(version, history?.currentVersion);
      if (result.unchanged) toasts.info(t.bringBackNothing);
      else {
        toasts.success(t.broughtBack(version));
        onchanged?.();
      }
      opened = null;
      await load();
    } catch (cause) {
      if (cause instanceof HistoryRequestError && cause.status === 409) {
        toasts.error(t.changedMeanwhile);
        await load();
      } else toasts.error(t.bringBackFailed);
    }
  }

  // Undoing one change.

  let expanded = $state<Record<string, boolean>>({});
  let undoing = $state<string | null>(null);
  let refused = $state<{ id: string; words: string[] } | null>(null);

  async function undo(changeset: HistoryChangeset, force = false) {
    undoing = changeset.id;
    try {
      const result = await api.undo(changeset.id, { force });
      if (!result.ok) {
        refused = { id: changeset.id, words: result.conflicts.map((id) => result.words[id]).filter((w): w is string => !!w) };
        return;
      }
      refused = null;
      if (result.changesetId) {
        toasts.success(t.undone(changeset.version));
        onchanged?.();
      } else toasts.info(t.nothingToUndo);
      await load();
    } catch (cause) {
      if (cause instanceof HistoryRequestError && cause.status === 409) {
        toasts.error(t.changedMeanwhile);
        await load();
      } else toasts.error(t.undoFailed);
    } finally {
      undoing = null;
    }
  }

  function reviewChanged() {
    onchanged?.();
    void load();
  }
</script>

{#snippet moments()}
  {#if opened && history}
    {#key opened.key}
      <MomentView
        {api}
        version={opened.version}
        since={opened.since}
        title={opened.title}
        currentVersion={history.currentVersion}
        {timeline}
        {labelOf}
        {numberEvery}
        {canEdit}
        {colorOf}
        {nameOf}
        onback={back}
        onsince={(since) => opened && (opened = { ...opened, since })}
        onname={(name) => nameVersion(opened!.version, name)}
        onbringback={() => bringBack(opened!.version)}
      />
    {/key}
  {:else if loading && !history}
    <p class="flex items-center gap-2 text-xs text-ink-muted"><Spinner size="sm" />{t.loading}</p>
  {:else if failure && !history}
    <Notice kind="error" title={failure}>
      <Button size="sm" variant="secondary" class="mt-2" onclick={load}>{t.retry}</Button>
    </Notice>
  {:else if history}
    {#if failure}
      <p class="mb-2 flex items-center gap-2 text-xs text-danger" role="alert">
        {failure}
        <button type="button" class="rounded text-ink-soft underline underline-offset-2 hover:text-ink" onclick={load}>{t.retry}</button>
      </p>
    {/if}
    <p class="mb-2 text-xs text-ink-muted">{t.nowVersion(history.currentVersion)}</p>
    {#if timeline.length === 0}
      <p class="text-sm text-ink-soft">{t.noHistory}</p>
    {:else}
      <ol class="space-y-0.5 border-l border-line pl-1.5">
        {#each timeline as entry (entry.key)}
          <li>
            {#if entry.type === 'moment'}
              {@const moment = entry.moment}
              <button
                type="button"
                data-history-entry={entry.key}
                class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sunken"
                onclick={() => openEntry(entry)}
              >
                {#if moment.kind === 'published'}
                  <BookmarkCheck class="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden="true" />
                {:else}
                  <Bookmark class="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden="true" />
                {/if}
                <span class="min-w-0 flex-1">
                  <span class="block font-medium break-words text-ink">
                    {#if moment.kind !== 'published'}<span class="sr-only">{t.namedMoment}: </span>{/if}{moment.name}
                  </span>
                  <span class="block text-xs text-ink-muted">
                    {#if moment.kind === 'published'}<span class="text-accent">{t.publishedMoment}</span> ·{' '}{/if}{formatMoment(moment.at, t)}
                    · {t.version(moment.version)}{#if moment.createdByName}{' '}· {moment.createdByName}{/if}
                  </span>
                </span>
              </button>
            {:else}
              {@const session = entry.session}
              {@const isOpen = !!expanded[session.key]}
              <div class="rounded-md">
                <button
                  type="button"
                  data-history-entry={entry.key}
                  class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sunken"
                  onclick={() => openEntry(entry)}
                >
                  <span class="mt-[0.4rem] size-2 shrink-0 rounded-full" style:background-color={colorOf(session.userId || null)} aria-hidden="true"
                  ></span>
                  <span class="min-w-0 flex-1">
                    <span class="block text-ink">
                      <span class="font-medium">{session.userName}</span>, <span class="text-ink-soft">{formatSpan(session.from, session.to, t)}</span>
                    </span>
                    <span class="block text-xs text-ink-muted">{session.summary}</span>
                  </span>
                </button>
                <button
                  type="button"
                  class="ml-6 inline-flex items-center gap-1 rounded px-1 text-xs text-ink-soft hover:text-ink"
                  aria-expanded={isOpen}
                  aria-controls={`${uid}-${session.key}`}
                  onclick={() => (expanded[session.key] = !isOpen)}
                >
                  <ChevronRight class={['size-3 transition-transform', isOpen && 'rotate-90']} aria-hidden="true" />
                  {isOpen ? t.hideChanges : t.showChanges(session.changesets.length)}
                </button>
                {#if isOpen}
                  <ul id={`${uid}-${session.key}`} class="mt-1 mb-1.5 ml-6 space-y-1" aria-label={t.changesOf}>
                    {#each session.changesets as changeset (changeset.id)}
                      <li class="rounded-md border border-line bg-surface px-2 py-1.5">
                        <div class="flex items-start gap-1.5">
                          <button
                            type="button"
                            data-history-entry={`c${changeset.id}`}
                            class="min-w-0 flex-1 rounded text-left text-xs hover:text-ink"
                            title={t.openChangeset(changeset.version)}
                            onclick={() => openChangeset(changeset)}
                          >
                            <span class="text-ink-muted tabular-nums">{t.versionShort(changeset.version)} · {formatTime(changeset.at)}</span>
                            <span class="block text-ink-soft">{changeset.message ?? describeCounts(changeset.counts, t)}</span>
                          </button>
                          {#if canEdit}
                            <Button
                              size="sm"
                              variant="ghost"
                              class="h-7 px-1.5 text-xs"
                              loading={undoing === changeset.id && refused?.id !== changeset.id}
                              disabled={undoing !== null}
                              onclick={() => undo(changeset)}
                            >
                              <Undo2 class="size-3.5" aria-hidden="true" />
                              {t.undo}
                            </Button>
                          {/if}
                        </div>
                        {#if refused?.id === changeset.id}
                          <Notice kind="warning" title={t.undoConflict} class="mt-1.5">
                            {#if refused.words.length}<span class="font-serif text-ink">{refused.words.join(', ')}</span>{/if}
                            <div class="mt-2 flex gap-2">
                              <Button size="sm" variant="danger" loading={undoing === changeset.id} onclick={() => undo(changeset, true)}>{t.undoAnyway}</Button>
                              <Button size="sm" variant="ghost" onclick={() => (refused = null)}>{t.cancel}</Button>
                            </div>
                          </Notice>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
        <li class="px-2 py-1.5 text-xs text-ink-muted">{history.truncated ? t.olderHidden : t.beginning}</li>
      </ol>
    {/if}
  {/if}
{/snippet}

<!-- Fills the height a host gives it and scrolls inside; without one it flows. -->
<section
  bind:this={root}
  class="author-palette flex h-full max-h-full w-full min-w-0 flex-col font-sans text-sm text-ink"
  aria-labelledby={`${uid}-title`}
>
  <h2 id={`${uid}-title`} class="sr-only">{t.title}</h2>
  {#if canEdit}
    <Tabs {tabs} bind:value={tab} label={t.tabsLabel} class="flex min-h-0 flex-1 flex-col">
      <TabPanel value="moments" class="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {@render moments()}
      </TabPanel>
      <TabPanel value="review" class="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {#if reviewOpened && history}
          <ReviewPanel
            {api}
            active={tab === 'review'}
            {canEdit}
            {currentVersion}
            moments={history.moments}
            {labelOf}
            {colorOf}
            onchanged={reviewChanged}
            onshow={showInText}
          />
        {:else if reviewOpened}
          <p class="flex items-center gap-2 text-xs text-ink-muted"><Spinner size="sm" />{t.loadingReview}</p>
        {/if}
      </TabPanel>
    </Tabs>
  {:else}
    <div class="min-h-0 flex-1 overflow-y-auto px-1 pt-2 pb-2">{@render moments()}</div>
  {/if}
</section>
