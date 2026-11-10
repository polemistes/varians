<script lang="ts">
  /**
   * One moment opened: the text as it stood then, read-only, with what
   * changed since the moment before marked in the colour of who changed it;
   * a choice of what to compare with; naming the moment; bringing the text
   * back as it was. Escape goes back to the present.
   */
  import { onMount, tick } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Bookmark from '@lucide/svelte/icons/bookmark';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import {
    Button,
    Dialog,
    Input,
    Notice,
    Select,
    Spinner,
    type SelectOption,
  } from '$lib/components/ui';
  import { compareOptions, type TimelineEntry } from '$lib/history/timeline';
  import { formatSpan } from '$lib/history/time';
  import type { Lineation } from '@varians/core';
  import type { DocumentAtVersion } from '$lib/history/types';
  import { historyStrings as t } from '$lib/strings/history';
  import type { HistoryApi } from './api';
  import StreamView from './StreamView.svelte';

  interface Props {
    api: HistoryApi;
    version: number;
    since: number;
    /** What was opened: a session's author and time, a moment's name. */
    title: string;
    /** The version the history panel last saw as current. */
    currentVersion: number;
    timeline: TimelineEntry[];
    labelOf: Record<string, string>;
    numberEvery: number;
    /** An edition's kind of a paragraph that is not marked. */
    lineation?: Lineation;
    canEdit: boolean;
    colorOf: (userId: string | null) => string;
    nameOf: (userId: string | null) => string;
    onback: () => void;
    onsince: (since: number) => void;
    /** Name the version; resolves true when it was named. */
    onname: (name: string) => Promise<boolean>;
    /** Bring the text back as it stood at the version. */
    onbringback: () => Promise<void>;
  }

  let {
    api,
    version,
    since,
    title,
    currentVersion,
    timeline,
    labelOf,
    numberEvery,
    lineation,
    canEdit,
    colorOf,
    nameOf,
    onback,
    onsince,
    onname,
    onbringback,
  }: Props = $props();

  const uid = $props.id();
  let container = $state<HTMLElement>();
  let heading = $state<HTMLElement>();

  let data = $state.raw<DocumentAtVersion | null>(null);
  let loading = $state(true);
  let failed = $state(false);
  let attempt = $state(0);
  let request = 0;

  $effect(() => {
    const wanted = { version, since };
    void attempt;
    const mine = ++request;
    loading = true;
    failed = false;
    api
      .at(wanted.version, wanted.since)
      .then((result) => {
        if (mine === request) data = result;
      })
      .catch(() => {
        if (mine === request) failed = true;
      })
      .finally(() => {
        if (mine === request) loading = false;
      });
  });

  onMount(() => heading?.focus());

  const labels = $derived({ ...(data?.labels ?? {}), ...labelOf });
  const nameFor = (userId: string | null): string =>
    (userId && data?.people[userId]) || nameOf(userId);

  /** Everyone whose changes are marked, for the legend. */
  const legend = $derived.by(() => {
    if (!data) return [];
    const ids = [...new Set(Object.values(data.authors))];
    return ids
      .map((id) => ({ id, name: nameFor(id), color: colorOf(id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const options = $derived.by((): SelectOption[] => {
    const list = compareOptions(timeline, version).map((option) => {
      const entry = option.entry;
      const what = !entry
        ? t.compareBeginning
        : entry.type === 'session'
          ? t.compareSession(
              entry.session.userName,
              formatSpan(entry.session.from, entry.session.to, t),
            )
          : t.compareMoment(entry.moment.name);
      return { version: option.version, label: `${t.versionShort(option.version)} · ${what}` };
    });
    if (!list.some((o) => o.version === since))
      list.push({ version: since, label: t.version(since) });
    return list
      .sort((a, b) => b.version - a.version)
      .map((o) => ({ value: String(o.version), label: o.label }));
  });

  let naming = $state(false);
  let name = $state('');
  let saving = $state(false);

  async function startNaming() {
    naming = true;
    await tick();
    document.getElementById(`${uid}-name`)?.focus();
  }

  async function submitName(event: SubmitEvent) {
    event.preventDefault();
    const wanted = name.trim();
    if (!wanted || saving) return;
    saving = true;
    const named = await onname(wanted);
    saving = false;
    if (named) {
      naming = false;
      name = '';
    }
  }

  let confirming = $state(false);
  let bringing = $state(false);

  async function bringBack() {
    bringing = true;
    try {
      await onbringback();
    } finally {
      bringing = false;
      confirming = false;
    }
  }

  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || confirming || !container?.contains(document.activeElement))
      return;
    event.preventDefault();
    if (naming) naming = false;
    else onback();
  }
</script>

<svelte:window onkeydown={keydown} />

<div bind:this={container} class="space-y-3">
  <Button variant="ghost" size="sm" class="-ml-2" onclick={onback}>
    <ArrowLeft class="size-4" aria-hidden="true" />
    {t.backToPresent}
  </Button>

  <div>
    <h3
      bind:this={heading}
      id={`${uid}-title`}
      tabindex="-1"
      class="font-medium text-ink outline-none"
    >
      {title}
    </h3>
    <p class="text-xs text-ink-muted">{t.asOf(version)}</p>
  </div>

  {#if version > 0}
    <label class="block">
      <span class="mb-1 block text-xs text-ink-soft">{t.compareWith}</span>
      <Select
        value={String(since)}
        {options}
        onchange={(event) => onsince(Number(event.currentTarget.value))}
      />
    </label>
  {/if}

  {#if legend.length}
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
      <span>{t.legend}</span>
      {#each legend as person (person.id)}
        <span class="author-palette inline-flex items-center gap-1.5">
          <span class="size-2 rounded-full" style:background-color={person.color} aria-hidden="true"
          ></span>
          {person.name}
        </span>
      {/each}
    </div>
  {/if}

  {#if loading && !data}
    <p class="flex items-center gap-2 text-xs text-ink-muted">
      <Spinner size="sm" />{t.loadingText}
    </p>
  {:else if failed}
    <Notice kind="error" title={t.failedText}>
      <Button size="sm" variant="secondary" class="mt-2" onclick={() => attempt++}>{t.retry}</Button
      >
    </Notice>
  {:else if data}
    {#if data.diff.changes.length === 0 && data.since < data.version}
      <p class="text-xs text-ink-muted">{t.noChangesBetween}</p>
    {/if}
    <div
      class={[
        'rounded-md border border-line bg-surface px-2 py-3 transition-opacity',
        loading && 'opacity-60',
      ]}
      aria-busy={loading}
    >
      <StreamView
        stream={data.stream}
        diff={data.diff}
        authors={data.authors}
        labelOf={labels}
        {numberEvery}
        {lineation}
        {colorOf}
        nameOf={nameFor}
        label={t.textLabel(data.version)}
      />
    </div>
  {/if}

  {#if canEdit}
    {#if naming}
      <form class="space-y-2" onsubmit={submitName}>
        <label class="block">
          <span class="mb-1 block text-xs text-ink-soft">{t.momentName}</span>
          <Input
            id={`${uid}-name`}
            bind:value={name}
            placeholder={t.momentNamePlaceholder}
            maxlength={200}
            required
          />
        </label>
        <div class="flex gap-2">
          <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!name.trim()}
            >{t.saveName}</Button
          >
          <Button size="sm" variant="ghost" onclick={() => (naming = false)}>{t.cancel}</Button>
        </div>
      </form>
    {:else}
      <div class="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onclick={startNaming}>
          <Bookmark class="size-4" aria-hidden="true" />
          {t.nameMoment}
        </Button>
        {#if version < currentVersion}
          <Button size="sm" variant="secondary" onclick={() => (confirming = true)}>
            <RotateCcw class="size-4" aria-hidden="true" />
            {t.bringBack}
          </Button>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<Dialog
  bind:open={confirming}
  title={t.bringBackTitle}
  description={t.bringBackText(version)}
  size="sm"
>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirming = false)}>{t.cancel}</Button>
    <Button variant="primary" loading={bringing} onclick={bringBack}>{t.bringBackConfirm}</Button>
  {/snippet}
</Dialog>
