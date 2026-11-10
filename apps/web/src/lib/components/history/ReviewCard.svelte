<script lang="ts">
  /**
   * One change to review: who made it and when, the lines it touched as they
   * were and as they became, and Accept, Reject and Later. A rejection that
   * later changes stand in the way of names the words and offers to reject
   * anyway.
   */
  import { Badge, Button, Notice } from '$lib/components/ui';
  import { formatMoment } from '$lib/history/time';
  import type { CompactLine, ReviewItem } from '$lib/history/types';
  import { historyStrings as t } from '$lib/strings/history';
  import MarkedCells from './MarkedCells.svelte';

  interface Props {
    item: ReviewItem;
    /** The CSS colour of the person who made the change. */
    color: string;
    labelFor: (segmentId: string | null) => string;
    canEdit: boolean;
    busy: boolean;
    /** The words a refused rejection would touch, which later changes touched too. */
    conflict: string[] | null;
    onaccept: () => void;
    onreject: (force: boolean) => void;
    onlater: () => void;
    oncancel: () => void;
    onshow: () => void;
  }

  let {
    item,
    color,
    labelFor,
    canEdit,
    busy,
    conflict,
    onaccept,
    onreject,
    onlater,
    oncancel,
    onshow,
  }: Props = $props();

  const shown = $derived(Math.max(item.before.length, item.after.length));
</script>

{#snippet side(label: string, lines: CompactLine[])}
  <div>
    <p class="text-[0.6875rem] font-medium tracking-wide text-ink-muted uppercase">{label}</p>
    {#if lines.length === 0}
      <p class="font-serif text-sm text-ink-muted italic">{t.beginningText}</p>
    {:else}
      {#each lines as line (line.key)}
        <div
          class="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-1.5 font-serif text-sm leading-relaxed text-ink"
        >
          <span
            class="pt-[0.25em] text-right font-sans text-[0.625rem] leading-normal text-ink-muted tabular-nums"
            >{labelFor(line.segmentId)}</span
          >
          <p class="min-w-0 break-words" dir="auto">
            <MarkedCells
              cells={line.cells}
              colorOf={() => color}
              nameOf={() => item.userName}
              {color}
            />
          </p>
        </div>
      {/each}
    {/if}
  </div>
{/snippet}

<article
  class={[
    'author-palette rounded-md border bg-surface p-3',
    item.accepted ? 'border-line opacity-75' : 'border-line-strong/60',
  ]}
  aria-label={t.reviewCard(item.userName, item.version)}
  data-review-card={item.id}
>
  <header class="flex items-start gap-2">
    <span
      class="mt-1.5 size-2 shrink-0 rounded-full"
      style:background-color={color}
      aria-hidden="true"
    ></span>
    <div class="min-w-0 flex-1">
      <p class="leading-snug">
        <span class="font-medium text-ink">{item.userName}</span>
        <span class="text-xs text-ink-muted"
          >{formatMoment(item.at, t)} · {t.versionShort(item.version)}</span
        >
      </p>
      <p class="text-xs text-ink-soft">{item.message ?? item.summary}</p>
    </div>
  </header>

  <div class="mt-2 space-y-2">
    {@render side(t.before, item.before)}
    {@render side(t.after, item.after)}
    {#if item.linesTouched > shown}
      <p class="text-xs text-ink-muted">{t.moreLines(item.linesTouched - shown)}</p>
    {/if}
  </div>

  {#if conflict}
    <Notice kind="warning" title={t.rejectConflict} class="mt-3">
      {#if conflict.length}<span class="font-serif text-ink">{conflict.join(', ')}</span>{/if}
      <div class="mt-2 flex gap-2">
        <Button size="sm" variant="danger" loading={busy} onclick={() => onreject(true)}
          >{t.rejectAnyway}</Button
        >
        <Button size="sm" variant="ghost" onclick={oncancel}>{t.cancel}</Button>
      </div>
    </Notice>
  {/if}

  <div class="mt-3 flex flex-wrap items-center gap-1.5">
    {#if item.accepted}
      <Badge tone="success">{t.accepted}</Badge>
    {:else if canEdit}
      <Button size="sm" variant="primary" disabled={busy} onclick={onaccept}>{t.accept}</Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || !!conflict}
        loading={busy && !conflict}
        onclick={() => onreject(false)}>{t.reject}</Button
      >
      <Button size="sm" variant="ghost" disabled={busy} onclick={onlater}>{t.later}</Button>
    {/if}
    <button
      type="button"
      class="ml-auto rounded text-xs text-ink-soft underline-offset-2 hover:text-ink hover:underline"
      onclick={onshow}
    >
      {t.showInText}
    </button>
  </div>
</article>
