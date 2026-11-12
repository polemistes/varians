<script lang="ts">
  /**
   * "Number lines from here" for verse: from the caret's line to
   * the end of the page, or for a number of lines, each line's first word
   * begins the next segment. The labels are resolved in one request and the
   * starts set in one batch.
   */
  import { untrack } from 'svelte';
  import { isToken, nextLabel, parseLabel } from '@varians/core';
  import { Button, Dialog, Field, Input, toasts } from '$lib/components/ui';
  import { labelSequence, lineStarts, numberingOps } from '$lib/workbench/numbering';
  import { proposeLabel } from '$lib/workbench/segments';
  import { workbench as t } from '$lib/strings/workbench';
  import WorkField from './WorkField.svelte';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    open: boolean;
  }

  let { wb, open = $bindable(false) }: Props = $props();

  let start = $state('');
  let count = $state<number | null>(null);
  let workId = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  /** The word numbering starts from: the caret's, else the page's first. */
  const from = $derived(wb.selection.caret ?? wb.pageStream.items.find(isToken)?.id ?? null);

  $effect(() => {
    if (!open) return;
    untrack(() => {
      const first = from ? lineStarts(wb.pageStream, from, 1)[0] : undefined;
      const proposal = first ? proposeLabel(wb.stream, first, wb.segments, wb.schemeOf) : null;
      start = proposal?.label ?? '';
      workId = proposal?.workId ?? wb.workId ?? wb.works[0]?.id ?? '';
      count = null;
      error = null;
    });
  });

  async function run(event: Event) {
    event.preventDefault();
    if (busy || !from || !workId) return;
    const scheme = wb.schemeOf(workId);
    const first = start.trim();
    if (!scheme || !parseLabel(scheme, first)) {
      error = t.segment.invalid(first);
      return;
    }
    const tokens = lineStarts(wb.pageStream, from, count && count > 0 ? count : undefined);
    if (tokens.length === 0) {
      error = t.numbering.nothing;
      return;
    }
    const labels = labelSequence(first, tokens.length, (label) => nextLabel(scheme, label));
    busy = true;
    const resolved = await wb.resolveLabels(workId, labels);
    busy = false;
    if (!resolved.ok) {
      error = resolved.message || t.segment.failed;
      return;
    }
    wb.workId = workId;
    wb.apply(numberingOps(tokens, resolved.ids));
    toasts.success(t.numbering.done(resolved.ids.length));
    if (labels.length < tokens.length) toasts.info(t.numbering.stopped(labels[labels.length - 1]!));
    open = false;
    queueMicrotask(() => wb.api?.focus());
  }
</script>

<Dialog bind:open title={t.numbering.title} description={t.numbering.description} size="sm">
  <form id="wb-number-lines" class="flex flex-col gap-4" onsubmit={run}>
    <Field label={t.numbering.start} {error}>
      {#snippet children(control)}
        <Input {...control} bind:value={start} autocomplete="off" class="font-serif" />
      {/snippet}
    </Field>
    <Field label={t.numbering.count} hint={t.numbering.countHint}>
      {#snippet children(control)}
        <Input {...control} type="number" min="1" bind:value={count} class="w-28" />
      {/snippet}
    </Field>
    <WorkField {wb} bind:value={workId} />
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{t.numbering.cancel}</Button>
    <Button
      type="submit"
      form="wb-number-lines"
      variant="primary"
      loading={busy}
      disabled={!workId || !start.trim()}
    >
      {t.numbering.run}
    </Button>
  {/snippet}
</Dialog>
