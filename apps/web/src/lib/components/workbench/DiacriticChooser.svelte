<script lang="ts">
  /**
   * The forms a marked word can be, after Normalize diacritics: shown beside
   * the word while the caret is on it, each with its lemma and grammar. A
   * click (or Alt and its number) takes one; "Leave as it is" unmarks the
   * word. The focus stays in the text.
   */
  import { Popover } from 'bits-ui';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { Id } from '@varians/core';
  import { workbench } from '$lib/strings/workbench';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    /** Where the editor's words are, to anchor the list at the word. */
    root: HTMLElement | undefined;
  }

  let { wb, root }: Props = $props();

  const t = workbench.tools.choose;

  const id = $derived<Id | null>(!wb.hasRange && wb.selection.caret && wb.diacriticChoices.has(wb.selection.caret) ? wb.selection.caret : null);
  const choice = $derived(id ? wb.diacriticChoices.get(id)! : null);
  const anchor = $derived(id && root ? root.querySelector<HTMLElement>(`[data-token="${CSS.escape(id)}"]`) : null);

  function take(value: string) {
    if (!id) return;
    const was = id;
    wb.chooseForm(was, value);
    go(1);
  }

  function go(direction: 1 | -1) {
    const next = wb.nearbyChoice(direction);
    if (next) wb.api?.placeCaret(next);
    wb.api?.focus();
  }

  function keydown(event: KeyboardEvent) {
    if (!choice || !event.altKey) return;
    const n = Number(event.key);
    if (Number.isInteger(n) && n >= 1 && n <= choice.options.length) {
      event.preventDefault();
      take(choice.options[n - 1]!.form);
    }
  }
</script>

<svelte:window onkeydown={keydown} />

{#if choice && anchor}
  <Popover.Root open={true}>
    <Popover.Portal>
      <Popover.Content
        customAnchor={anchor}
        side="bottom"
        align="start"
        sideOffset={6}
        trapFocus={false}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        class="z-40 w-80 rounded-md border border-line bg-surface p-2 font-sans text-sm shadow-pop"
        aria-label={t.label}
      >
        <p class="px-1 pb-1 text-xs text-ink-muted">
          {choice.reason === 'unknown' ? t.unknown : choice.reason === 'disagrees' ? t.disagrees : t.several}
        </p>
        <ul class="flex flex-col">
          {#each choice.options as option, k (option.form)}
            <li>
              <button type="button" class="flex w-full items-baseline gap-2 rounded px-1 py-1 text-left hover:bg-sunken" onclick={() => take(option.form)}>
                {#if k < 9}<kbd class="w-4 shrink-0 text-xs text-ink-muted">{k + 1}</kbd>{/if}
                <span class="font-serif text-base text-ink" lang="grc">{option.form}</span>
                <span class="flex min-w-0 flex-col text-xs text-ink-soft">
                  {#each option.readings as reading (reading.lemma)}
                    <span><span lang="grc">{reading.lemma}</span>{reading.descriptions.length ? ` · ${reading.descriptions.join('; ')}` : ''}</span>
                  {/each}
                </span>
              </button>
            </li>
          {/each}
        </ul>
        <div class="mt-1 flex items-center gap-1 border-t border-line pt-1">
          <button type="button" class="rounded px-1.5 py-0.5 text-xs text-ink-soft hover:bg-sunken hover:text-ink" onclick={() => { if (id) wb.dismissChoice(id); go(1); }}>{t.keep}</button>
          <button type="button" class="ml-auto rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink" title={t.previous} aria-label={t.previous} onclick={() => go(-1)}>
            <ChevronLeft class="size-4" aria-hidden="true" />
          </button>
          <button type="button" class="rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink" title={t.next} aria-label={t.next} onclick={() => go(1)}>
            <ChevronRight class="size-4" aria-hidden="true" />
          </button>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}
