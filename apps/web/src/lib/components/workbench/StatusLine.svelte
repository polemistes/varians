<script lang="ts">
  /** The status line: saving, a passing message, the page, its lines, words in Staging, unmapped and to check, read forms proposed. */
  import { UNPLACED } from '$lib/workbench/pages';
  import { Spinner } from '$lib/components/ui';
  import { workbench as t } from '$lib/strings/workbench';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    onproposals: () => void;
    onunchecked: () => void;
  }

  let { wb, onproposals, onunchecked }: Props = $props();

  const dot = 'text-ink-muted select-none';

  /** Go to the word to choose before or after the caret. */
  function step(direction: 1 | -1) {
    const id = wb.nearbyChoice(direction);
    if (id) {
      wb.api?.placeCaret(id);
      wb.api?.focus();
    }
  }
</script>

<div
  class="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-surface px-4 py-1 font-sans text-xs text-ink-soft"
  role="status"
  aria-live="polite"
>
  {#if !wb.canEdit}
    <span>{t.status.readOnly}</span>
  {:else if wb.saveError}
    <span class="text-danger">{t.status.notSaved(wb.saveError)}</span>
    <button
      type="button"
      class="text-accent underline-offset-2 hover:underline"
      onclick={() => wb.retry()}>{t.status.retry}</button
    >
  {:else if wb.saving}
    <span class="inline-flex items-center gap-1.5"><Spinner size="sm" />{t.status.saving}</span>
  {:else if wb.pending > 0}
    <span>{t.status.unsaved(wb.pending)}</span>
  {:else}
    <span>{t.status.saved}</span>
  {/if}
  {#if wb.notice}
    {@const notice = wb.notice}
    <span class={dot} aria-hidden="true">·</span>
    <span class="text-ink">{notice.text}</span>
    {#if notice.view !== null && notice.view !== wb.view}
      <button
        type="button"
        class="text-accent underline-offset-2 hover:underline"
        onclick={() => wb.goTo(notice.view)}>{t.move.show}</button
      >
    {/if}
  {/if}
  {#if wb.pages.length > 0}
    <span class={dot} aria-hidden="true">·</span>
    <span>{wb.pageLabel}</span>
  {/if}
  <span class={dot} aria-hidden="true">·</span>
  <span>{t.status.lines(wb.lines)}</span>
  {#if wb.pages.length > 0 && wb.view !== UNPLACED && wb.unplacedWords > 0}
    <span class={dot} aria-hidden="true">·</span>
    <button type="button" class="hover:text-ink hover:underline" onclick={() => wb.goTo(UNPLACED)}
      >{t.status.unplaced(wb.unplacedWords)}</button
    >
  {/if}
  {#if wb.witnessPage?.source && wb.pageZones}
    <span class={dot} aria-hidden="true">·</span>
    <span>{t.status.unmapped(wb.unmapped.length)}</span>
  {/if}
  {#if wb.unchecked > 0}
    <span class={dot} aria-hidden="true">·</span>
    <button type="button" class="hover:text-ink hover:underline" onclick={onunchecked}
      >{t.status.unchecked(wb.unchecked)}</button
    >
  {/if}
  {#if wb.canEdit && wb.diacriticChoices.size > 0}
    <span class={dot} aria-hidden="true">·</span>
    <span class="inline-flex items-center gap-1">
      <button
        type="button"
        class="rounded px-1 hover:bg-sunken hover:text-ink"
        aria-label={t.tools.choose.previous}
        title={t.tools.choose.previous}
        onclick={() => step(-1)}>‹</button
      >
      <button type="button" class="hover:text-ink hover:underline" onclick={() => step(1)}
        >{t.tools.choose.count(wb.diacriticChoices.size)}</button
      >
      <button
        type="button"
        class="rounded px-1 hover:bg-sunken hover:text-ink"
        aria-label={t.tools.choose.next}
        title={t.tools.choose.next}
        onclick={() => step(1)}>›</button
      >
    </span>
  {/if}
  {#if wb.canEdit && wb.proposals.length > 0}
    <button
      type="button"
      class="ml-auto rounded-md border border-accent/30 bg-accent-soft px-2 py-0.5 font-medium text-accent hover:border-accent/60"
      onclick={onproposals}
    >
      {t.status.proposals(wb.proposals.length)}
    </button>
  {/if}
</div>
