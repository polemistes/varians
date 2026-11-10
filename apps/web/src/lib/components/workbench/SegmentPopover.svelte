<script lang="ts">
  /**
   * Setting the segment that begins at a word, in a small
   * popover at the word: the label (the one shown, else the one after the
   * previous start), the work, and the two other answers, "unassigned from
   * here" and "remove this start".
   */
  import { untrack } from 'svelte';
  import { Popover } from 'bits-ui';
  import { parseLabel, segmentStartOf, type Id } from '@varians/core';
  import { Button, Field, Input, Select } from '$lib/components/ui';
  import { otherRuns, partFor, proposeLabel, segmentOp } from '$lib/workbench/segments';
  import { workbench as t } from '$lib/strings/workbench';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    /** The word asked about; null when closed. */
    request: { tokenId: Id; current: string | null } | null;
    /** Where the editor's words are, to anchor the popover at the word. */
    root: HTMLElement | undefined;
    onclose: () => void;
  }

  let { wb, request, root, onclose }: Props = $props();

  let label = $state('');
  let workId = $state('');
  let part = $state<number | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let anchor = $state<HTMLElement | { getBoundingClientRect: () => DOMRect } | null>(null);

  const open = $derived(request !== null);
  const token = $derived(request ? wb.stream.items.find((i) => i.id === request.tokenId) : undefined);
  const hasStart = $derived(token ? Boolean(segmentStartOf(token)) : false);
  const works = $derived(wb.works);
  const scheme = $derived(workId ? wb.schemeOf(workId) : undefined);
  const example = $derived(scheme ? scheme.levels.map((l, i) => (i === 0 ? '' : l.separator) + (l.type === 'number' ? '1' : 'a')).join('') : '');
  /** The segment the label names, when the workbench knows it already: for the part number. */
  const known = $derived(
    Object.entries(wb.segments).find(([, s]) => s.workId === workId && s.label === label.trim())?.[0] ?? null,
  );
  const elsewhere = $derived(known && request ? otherRuns(wb.stream, known, request.tokenId).length > 0 : false);

  // Fill the form when a word is asked about (and only then: later edits leave what is typed alone).
  $effect(() => {
    const asked = request;
    if (!asked) return;
    untrack(() => {
      const proposal = proposeLabel(wb.stream, asked.tokenId, wb.segments, wb.schemeOf);
      label = proposal.label;
      workId = proposal.workId ?? wb.workId ?? works[0]?.id ?? '';
      error = null;
      busy = false;
      part = null;
      anchor = findAnchor(asked.tokenId);
    });
  });

  $effect(() => {
    if (known && request && elsewhere && part === null) part = partFor(wb.stream, known, request.tokenId) ?? null;
  });

  function findAnchor(tokenId: Id) {
    const element = root?.querySelector<HTMLElement>(`[data-token="${CSS.escape(tokenId)}"]`);
    if (element) return element;
    const rect = wb.api?.selectionRect();
    if (rect) return { getBoundingClientRect: () => new DOMRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top) };
    return root ?? null;
  }

  function close() {
    onclose();
    queueMicrotask(() => wb.api?.focus());
  }

  async function submit(event: Event) {
    event.preventDefault();
    if (!request || busy) return;
    const text = label.trim();
    if (!text) return;
    if (!scheme || !parseLabel(scheme, text)) {
      error = t.segment.invalid(text);
      return;
    }
    busy = true;
    const resolved = await wb.resolveLabels(workId, [text]);
    busy = false;
    if (!resolved.ok) {
      error = resolved.message || t.segment.failed;
      return;
    }
    const segmentId = resolved.ids[0]!;
    const number = elsewhere && part !== null ? part : partFor(wb.stream, segmentId, request.tokenId);
    wb.apply([segmentOp(request.tokenId, segmentId, number)]);
    close();
  }

  function unassign() {
    if (!request) return;
    wb.apply([segmentOp(request.tokenId, null)]);
    close();
  }

  function remove() {
    if (!request) return;
    wb.apply([segmentOp(request.tokenId, undefined)]);
    close();
  }
</script>

<Popover.Root
  {open}
  onOpenChange={(next) => {
    if (!next) close();
  }}
>
  <Popover.Portal>
    <Popover.Content
      customAnchor={anchor}
      side="bottom"
      align="start"
      sideOffset={8}
      onCloseAutoFocus={(event) => event.preventDefault()}
      class="z-50 w-80 rounded-md border border-line bg-surface p-4 font-sans text-sm text-ink shadow-pop outline-none animate-fade-in"
    >
      <form class="flex flex-col gap-3" onsubmit={submit} aria-label={t.segment.title}>
        <p class="font-medium">{t.segment.title}</p>
        {#if works.length === 0}
          <p class="text-ink-soft">{t.segment.noWork}</p>
        {:else}
          <Field label={t.segment.label} hint={example ? t.segment.hint(example) : undefined} error={error}>
            {#snippet children(control)}
              <Input {...control} bind:value={label} autocomplete="off" spellcheck="false" class="font-serif" />
            {/snippet}
          </Field>
          {#if works.length > 1}
            <Field label={t.segment.work}>
              {#snippet children(control)}
                <Select {...control} bind:value={workId} options={works.map((w) => ({ value: w.id, label: w.title }))} />
              {/snippet}
            </Field>
          {/if}
          {#if elsewhere}
            <Field label={t.segment.part} hint={t.segment.partHint(part ?? 2)}>
              {#snippet children(control)}
                <Input {...control} type="number" min="1" bind:value={part} class="w-20" />
              {/snippet}
            </Field>
          {/if}
        {/if}
        <div class="flex flex-wrap items-center gap-2">
          {#if works.length > 0}
            <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!label.trim()}>{t.segment.set}</Button>
          {/if}
          <Button size="sm" variant="ghost" onclick={close}>{t.segment.cancel}</Button>
        </div>
        <div class="flex flex-col items-start gap-1 border-t border-line pt-2">
          <button type="button" class="text-accent hover:underline" onclick={unassign}>
            {t.segment.unassign}
          </button>
          {#if hasStart}
            <button type="button" class="text-danger hover:underline" onclick={remove}>{t.segment.remove}</button>
          {/if}
        </div>
      </form>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
