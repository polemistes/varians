<script lang="ts">
  /**
   * The bar above the text: the page chooser with its arrows,
   * the form shown where the transcript keeps both, Language, and the
   * Insert and Tools menus. The chooser lists Staging (with its words when it
   * has any), every page of the witness with a mark where it has text in
   * this transcript, the whole text, and Pages…. A witness without pages
   * has no chooser: its text is the text.
   */
  import { DropdownMenu } from 'bits-ui';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { IconButton } from '$lib/components/ui';
  import LanguageControl from '$lib/components/editor/LanguageControl.svelte';
  import { workbench as t } from '$lib/strings/workbench';
  import { UNPLACED, WHOLE } from '$lib/workbench/pages';
  import InsertMenu from './InsertMenu.svelte';
  import ToolsMenu from './ToolsMenu.svelte';
  import TakeFormsDialog from './TakeFormsDialog.svelte';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    /** Show the Pages tab of the side pane. */
    onpages: () => void;
    /** The Tools menu's windows. */
    onimport: () => void;
    onnumber: () => void;
  }

  let { wb, onpages, onimport, onnumber }: Props = $props();

  let takeOpen = $state(false);

  const itemClass =
    'flex w-full cursor-default items-center gap-2 rounded px-2 py-1.5 text-left text-ink outline-none select-none data-highlighted:bg-sunken data-disabled:pointer-events-none data-disabled:opacity-50';
  const editable = $derived(wb.canEdit && wb.view !== WHOLE);
</script>

<div
  class="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-3 py-1 font-sans text-sm"
  data-text-bar
>
  {#if wb.pages.length > 0}
    <nav class="flex items-center gap-0.5" aria-label={t.pages.label}>
      <IconButton
        label={t.pages.previous}
        size="sm"
        disabled={wb.neighbours.previous === null}
        onclick={() => wb.goTo(wb.neighbours.previous)}
      >
        <ChevronLeft aria-hidden="true" />
      </IconButton>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class="inline-flex h-8 min-w-24 items-center justify-center gap-1 rounded-md px-2 text-sm font-medium text-ink hover:bg-sunken data-[state=open]:bg-sunken"
          aria-label={t.pages.choose}
        >
          <span class="max-w-48 truncate">{wb.pageLabel}</span>
          <ChevronDown class="size-3.5 text-ink-muted" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            class="z-50 max-h-[70vh] min-w-56 overflow-y-auto rounded-md border border-line bg-surface p-1 font-sans text-sm shadow-pop outline-none animate-fade-in"
          >
            <DropdownMenu.Item class={itemClass} onSelect={() => wb.goTo(UNPLACED)}>
              <span class="flex-1">{t.pages.unplaced}</span>
              {#if wb.unplacedWords > 0}<span class="text-xs text-ink-muted"
                  >{t.pages.unplacedWords(wb.unplacedWords)}</span
                >{/if}
              {#if wb.view === UNPLACED}<span class="text-accent" aria-hidden="true">●</span>{/if}
            </DropdownMenu.Item>
            <DropdownMenu.Separator class="my-1 h-px bg-line" />
            {#each wb.pages as page (page.id)}
              <DropdownMenu.Item class={itemClass} onSelect={() => wb.goTo(page.id)}>
                <span
                  class="w-3 text-center text-xs text-ink-muted"
                  title={wb.textOnPages.has(page.id) ? t.pages.hasText : undefined}
                >
                  {#if wb.textOnPages.has(page.id)}<span aria-label={t.pages.hasText}>▪</span>{/if}
                </span>
                <span class="flex-1">{page.label}</span>
                {#if wb.view === page.id}<span class="text-accent" aria-hidden="true">●</span>{/if}
              </DropdownMenu.Item>
            {/each}
            <DropdownMenu.Separator class="my-1 h-px bg-line" />
            <DropdownMenu.Item
              class={itemClass}
              onSelect={() => wb.goTo(WHOLE)}
              title={t.pages.wholeHint}
            >
              <span class="flex-1">{t.pages.whole}</span>
              {#if wb.view === WHOLE}<span class="text-accent" aria-hidden="true">●</span>{/if}
            </DropdownMenu.Item>
            <DropdownMenu.Item class={itemClass} onSelect={onpages} title={t.pages.manageHint}>
              <span class="flex-1">{t.pages.manage}</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <IconButton
        label={t.pages.next}
        size="sm"
        disabled={wb.neighbours.next === null}
        onclick={() => wb.goTo(wb.neighbours.next)}
      >
        <ChevronRight aria-hidden="true" />
      </IconButton>
    </nav>
  {/if}

  {#if wb.keepsWrittenForm}
    <div
      class="inline-flex rounded-md border border-line p-0.5"
      role="group"
      aria-label={t.form.label}
    >
      {#each [{ value: 'written', label: t.form.written, hint: t.form.writtenHint }, { value: 'read', label: t.form.read, hint: t.form.readHint }] as option (option.value)}
        <button
          type="button"
          aria-pressed={wb.form === option.value}
          title={option.hint}
          class={[
            'h-7 rounded px-2.5 text-sm transition-colors',
            wb.form === option.value
              ? 'bg-accent text-accent-ink'
              : 'text-ink-soft hover:bg-sunken hover:text-ink',
          ]}
          onclick={() => (wb.form = option.value as 'written' | 'read')}
        >
          {option.label}
        </button>
      {/each}
    </div>
  {/if}

  {#if editable}<LanguageControl language={wb.language} />{/if}

  {#if wb.canEdit}
    {#if editable}<InsertMenu {wb} />{/if}
    <ToolsMenu {wb} ontake={() => (takeOpen = true)} {onimport} {onnumber} />
  {/if}
</div>

{#if wb.canEdit}<TakeFormsDialog {wb} bind:open={takeOpen} />{/if}
