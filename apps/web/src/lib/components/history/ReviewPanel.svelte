<script lang="ts">
  /**
   * Reviewing the changes of others: from a chosen moment, by
   * default where the reviewer last left off, the changes since in the order
   * of the text, each accepted, rejected (undone by a new change of the
   * reviewer's) or left for later; with how many are left.
   */
  import { tick } from 'svelte';
  import { Button, EmptyState, Notice, Select, Spinner, toasts, type SelectOption } from '$lib/components/ui';
  import type { HistoryMoment, ReviewChanges, ReviewItem } from '$lib/history/types';
  import { historyStrings as t } from '$lib/strings/history';
  import { HistoryRequestError, type HistoryApi } from './api';
  import ReviewCard from './ReviewCard.svelte';

  interface Props {
    api: HistoryApi;
    /** Whether the review tab is showing: it reloads only then. */
    active: boolean;
    canEdit: boolean;
    /** The document's version; the list reloads when it moves. */
    currentVersion: number;
    moments: HistoryMoment[];
    labelOf: Record<string, string>;
    colorOf: (userId: string | null) => string;
    /** After a rejection changed the text. */
    onchanged: () => void;
    /** Open the text at the change. */
    onshow: (item: ReviewItem) => void;
  }

  let { api, active, canEdit, currentVersion, moments, labelOf, colorOf, onchanged, onshow }: Props = $props();

  let container = $state<HTMLElement>();
  let data = $state.raw<ReviewChanges | null>(null);
  let loading = $state(true);
  let failure = $state<string | null>(null);
  /** Changes put off with Later, in the order they were put off. */
  let deferred = $state<string[]>([]);
  let busy = $state<string | null>(null);
  let conflicts = $state<Record<string, string[]>>({});
  let showReviewed = $state(false);
  let request = 0;

  async function load() {
    const mine = ++request;
    failure = null;
    try {
      const result = await api.review();
      if (mine !== request) return;
      data = result;
      loadedAt = result.currentVersion;
    } catch (cause) {
      if (mine !== request) return;
      if (cause instanceof HistoryRequestError && cause.status === 401) failure = t.loginToReview;
      else if (cause instanceof HistoryRequestError && cause.status === 0) failure = t.offline;
      else failure = t.failedReview;
    } finally {
      if (mine === request) loading = false;
    }
  }

  let loadedAt = -1;
  $effect(() => {
    const version = currentVersion;
    void api;
    if (!active) return;
    const first = loadedAt < 0;
    if (!first && loadedAt === version) return;
    const timer = setTimeout(() => {
      loadedAt = version;
      void load();
    }, first ? 0 : 400);
    return () => clearTimeout(timer);
  });

  const pending = $derived.by(() => {
    if (!data) return [];
    const open = data.items.filter((i) => !i.accepted);
    const later = new Set(deferred);
    return [...open.filter((i) => !later.has(i.id)), ...deferred.map((id) => open.find((i) => i.id === id)).filter((i): i is ReviewItem => !!i)];
  });
  const reviewed = $derived(data ? data.items.filter((i) => i.accepted) : []);

  const counter = $derived.by(() => {
    if (!data || data.items.length === 0) return t.reviewNone;
    if (data.remaining === 0) return t.reviewUpToDate;
    return t.reviewLeft(data.remaining, data.items.length);
  });

  const fromOptions = $derived.by((): SelectOption[] => {
    const byVersion = new Map<number, string>([[0, t.beginning]]);
    for (const moment of moments) if (!byVersion.has(moment.version)) byVersion.set(moment.version, t.reviewMoment(moment.name, moment.version));
    if (data && !byVersion.has(data.fromVersion)) byVersion.set(data.fromVersion, t.reviewPoint(data.fromVersion));
    return [...byVersion.entries()].sort((a, b) => b[0] - a[0]).map(([version, label]) => ({ value: String(version), label }));
  });

  const labelFor = (segmentId: string | null): string => (segmentId ? (labelOf[segmentId] ?? data?.labels[segmentId] ?? '') : '');

  /** After a card leaves the list, focus the one now in its place. */
  async function focusAt(index: number) {
    await tick();
    const cards = container?.querySelectorAll<HTMLElement>('[data-pending] [data-review-card]') ?? [];
    const card = cards[Math.min(index, cards.length - 1)];
    card?.querySelector<HTMLElement>('button')?.focus();
  }

  async function accept(item: ReviewItem) {
    const index = pending.findIndex((i) => i.id === item.id);
    busy = item.id;
    try {
      await api.accept([item.id]);
      if (data) {
        data = { ...data, items: data.items.map((i) => (i.id === item.id ? { ...i, accepted: true } : i)), remaining: Math.max(0, data.remaining - 1) };
      }
      deferred = deferred.filter((id) => id !== item.id);
      await focusAt(index);
    } catch {
      toasts.error(t.reviewFailed);
    } finally {
      busy = null;
    }
  }

  async function reject(item: ReviewItem, force: boolean) {
    const index = pending.findIndex((i) => i.id === item.id);
    busy = item.id;
    try {
      const result = await api.undo(item.id, { force, reviewed: true });
      if (!result.ok) {
        conflicts = { ...conflicts, [item.id]: result.conflicts.map((id) => result.words[id]).filter((w): w is string => !!w) };
        return;
      }
      const { [item.id]: _, ...rest } = conflicts;
      conflicts = rest;
      if (result.changesetId) toasts.success(t.rejected(item.version));
      else toasts.info(t.nothingToUndo);
      onchanged();
      await load();
      await focusAt(index);
    } catch (cause) {
      if (cause instanceof HistoryRequestError && cause.status === 409) {
        toasts.error(t.changedMeanwhile);
        await load();
      } else toasts.error(t.reviewFailed);
    } finally {
      busy = null;
    }
  }

  async function later(item: ReviewItem) {
    const index = pending.findIndex((i) => i.id === item.id);
    deferred = [...deferred.filter((id) => id !== item.id), item.id];
    await focusAt(index);
  }

  async function reviewFrom(version: number) {
    try {
      await api.reviewFrom(version);
      deferred = [];
      conflicts = {};
      toasts.info(t.reviewPointMoved(version));
      await load();
    } catch {
      toasts.error(t.reviewFailed);
    }
  }
</script>

<div bind:this={container} class="space-y-3">
  {#if loading && !data}
    <p class="flex items-center gap-2 text-xs text-ink-muted"><Spinner size="sm" />{t.loadingReview}</p>
  {:else if failure && !data}
    <Notice kind={failure === t.loginToReview ? 'info' : 'error'} title={failure}>
      {#if failure !== t.loginToReview}
        <Button size="sm" variant="secondary" class="mt-2" onclick={load}>{t.retry}</Button>
      {/if}
    </Notice>
  {:else if data}
    <div class="space-y-1.5">
      <label class="block">
        <span class="mb-1 block text-xs text-ink-soft">{t.reviewFrom}</span>
        <Select
          value={String(data.fromVersion)}
          options={fromOptions}
          disabled={!canEdit}
          onchange={(event) => reviewFrom(Number(event.currentTarget.value))}
        />
      </label>
      <p class="text-xs text-ink-muted">{t.reviewFromHint}</p>
    </div>

    <div class="flex items-center justify-between gap-2">
      <p class="text-sm font-medium text-ink" aria-live="polite">{counter}</p>
      {#if canEdit && data.fromVersion < data.currentVersion}
        <Button size="sm" variant="ghost" onclick={() => reviewFrom(data!.currentVersion)}>{t.startNextReview}</Button>
      {/if}
    </div>

    {#if data.truncated}
      <Notice kind="info">{t.reviewTruncated}</Notice>
    {/if}

    {#if data.items.length === 0}
      <EmptyState description={t.reviewNone} />
    {:else}
      <div class="space-y-2.5" data-pending>
        {#each pending as item (item.id)}
          <ReviewCard
            {item}
            color={colorOf(item.userId || null)}
            {labelFor}
            {canEdit}
            busy={busy === item.id}
            conflict={conflicts[item.id] ?? null}
            onaccept={() => accept(item)}
            onreject={(force) => reject(item, force)}
            onlater={() => later(item)}
            oncancel={() => {
              const { [item.id]: _, ...rest } = conflicts;
              conflicts = rest;
            }}
            onshow={() => onshow(item)}
          />
        {/each}
      </div>

      {#if reviewed.length}
        <div class="flex items-center gap-2 text-xs text-ink-muted">
          <span>{t.reviewed(reviewed.length)}</span>
          <button
            type="button"
            class="rounded text-ink-soft underline-offset-2 hover:text-ink hover:underline"
            aria-expanded={showReviewed}
            onclick={() => (showReviewed = !showReviewed)}
          >
            {showReviewed ? t.hideReviewed : t.showReviewed}
          </button>
        </div>
        {#if showReviewed}
          <div class="space-y-2.5">
            {#each reviewed as item (item.id)}
              <ReviewCard
                {item}
                color={colorOf(item.userId || null)}
                {labelFor}
                {canEdit}
                busy={false}
                conflict={null}
                onaccept={() => {}}
                onreject={() => {}}
                onlater={() => {}}
                oncancel={() => {}}
                onshow={() => onshow(item)}
              />
            {/each}
          </div>
        {/if}
      {/if}
    {/if}
  {/if}
</div>
