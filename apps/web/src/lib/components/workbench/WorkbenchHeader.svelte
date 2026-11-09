<script lang="ts">
  /**
   * The workbench's bar (PLAN 6.2): the witness and the transcription, the
   * form shown, the Insert menu, the page with its neighbours and the pages
   * not yet placed, and the menu of whole-text actions.
   */
  import { DropdownMenu } from 'bits-ui';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import PanelRightClose from '@lucide/svelte/icons/panel-right-close';
  import PanelRightOpen from '@lucide/svelte/icons/panel-right-open';
  import { Badge, IconButton, Menu, MenuItem, MenuSeparator } from '$lib/components/ui';
  import { workbench as t } from '$lib/strings/workbench';
  import InsertMenu from './InsertMenu.svelte';
  import ToolsMenu from './ToolsMenu.svelte';
  import TakeFormsDialog from './TakeFormsDialog.svelte';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    paneOpen: boolean;
    ontogglepane: () => void;
    onimport: () => void;
    onsettings: () => void;
    ondelete: () => void;
    onnumber: () => void;
    /** Make a copy of one's own; absent for a visitor. */
    oncopy?: () => void;
    /** Show the Pages tab of the side pane. */
    onpages: () => void;
  }

  let { wb, paneOpen, ontogglepane, onimport, onsettings, ondelete, onnumber, oncopy, onpages }: Props = $props();

  let takeOpen = $state(false);

  const itemClass =
    'flex w-full cursor-default items-center gap-2 rounded px-2 py-1.5 text-left text-ink outline-none select-none data-highlighted:bg-sunken data-disabled:pointer-events-none data-disabled:opacity-50';
</script>

<div class="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-1.5 font-sans text-sm">
  <div class="flex min-w-0 items-baseline gap-2">
    <a
      href="/witnesses/{wb.witness.slug}"
      class="truncate text-ink hover:text-accent"
      title={t.backToWitness(wb.witness.name)}
    >
      <span class="font-semibold">{wb.witness.siglum}</span>
      <span class="text-ink-muted" aria-hidden="true">·</span>
      <span>{wb.witness.name}</span>
    </a>
    <span class="text-ink-muted" aria-hidden="true">·</span>
    <h1 class="truncate font-medium text-ink">{wb.name}</h1>
    {#if wb.visibility === 'draft'}<Badge>{t.draft}</Badge>{/if}
    {#if !wb.canEdit}<Badge tone="accent">{t.readOnly}</Badge>{/if}
  </div>

  <div class="ml-auto flex flex-wrap items-center gap-3">
    {#if wb.keepsWrittenForm}
      <div class="inline-flex rounded-md border border-line p-0.5" role="group" aria-label={t.form.label}>
        {#each [{ value: 'written', label: t.form.written, hint: t.form.writtenHint }, { value: 'read', label: t.form.read, hint: t.form.readHint }] as option (option.value)}
          <button
            type="button"
            aria-pressed={wb.form === option.value}
            title={option.hint}
            class={[
              'h-7 rounded px-2.5 text-sm transition-colors',
              wb.form === option.value ? 'bg-accent text-accent-ink' : 'text-ink-soft hover:bg-sunken hover:text-ink',
            ]}
            onclick={() => (wb.form = option.value as 'written' | 'read')}
          >
            {option.label}
          </button>
        {/each}
      </div>
    {/if}

    {#if wb.canEdit}<InsertMenu {wb} /><ToolsMenu {wb} ontake={() => (takeOpen = true)} />{/if}

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
          class="inline-flex h-8 min-w-16 items-center justify-center gap-1 rounded-md px-2 text-sm font-medium text-ink hover:bg-sunken data-[state=open]:bg-sunken"
          aria-label={t.pages.choose}
        >
          <span class="max-w-40 truncate">{wb.pageLabel || t.pages.none}</span>
          <ChevronDown class="size-3.5 text-ink-muted" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="center"
            sideOffset={6}
            class="z-50 max-h-[70vh] min-w-56 overflow-y-auto rounded-md border border-line bg-surface p-1 font-sans text-sm shadow-pop outline-none animate-fade-in"
          >
            <DropdownMenu.Item class={itemClass} onSelect={() => wb.goTo(null)}>
              <span class="flex-1">{t.pages.whole}</span>
              {#if wb.page === null}<span class="text-accent" aria-hidden="true">●</span>{/if}
            </DropdownMenu.Item>
            {#if wb.streamPages.length}
              <DropdownMenu.Separator class="my-1 h-px bg-line" />
              <DropdownMenu.Group>
                <DropdownMenu.GroupHeading class="px-2 py-1 text-xs text-ink-muted">{t.pages.inText}</DropdownMenu.GroupHeading>
                {#each wb.streamPages as page (page.key)}
                  <DropdownMenu.Item class={itemClass} onSelect={() => wb.goTo(page.key)}>
                    <span class="flex-1">{page.label}</span>
                    {#if wb.page === page.key}<span class="text-accent" aria-hidden="true">●</span>{/if}
                  </DropdownMenu.Item>
                {/each}
              </DropdownMenu.Group>
            {/if}
            {#if wb.unplaced.length}
              <DropdownMenu.Separator class="my-1 h-px bg-line" />
              <DropdownMenu.Group>
                <DropdownMenu.GroupHeading class="px-2 py-1 text-xs text-ink-muted">{t.pages.notPlaced}</DropdownMenu.GroupHeading>
                {#each wb.unplaced as page (page.id)}
                  {#if wb.canEdit && wb.stream.items.length > 0}
                    <DropdownMenu.Item class={itemClass} onSelect={() => wb.placePage(page.id)} title={t.pages.placeHint}>
                      {t.pages.placeAtCaret(page.label)}
                    </DropdownMenu.Item>
                  {:else}
                    <DropdownMenu.Item class={itemClass} onSelect={() => wb.goTo(page.id)}>
                      <span class="flex-1">{t.pages.newPage(page.label)}</span>
                      {#if wb.page === page.id}<span class="text-accent" aria-hidden="true">●</span>{/if}
                    </DropdownMenu.Item>
                  {/if}
                {/each}
              </DropdownMenu.Group>
            {/if}
            <DropdownMenu.Separator class="my-1 h-px bg-line" />
            <DropdownMenu.Item class={itemClass} onSelect={onpages} title={t.pages.manageHint}>
              <span class="flex-1">{t.pages.manage}</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <IconButton label={t.pages.next} size="sm" disabled={!wb.neighbours.next} onclick={() => wb.goTo(wb.neighbours.next)}>
        <ChevronRight aria-hidden="true" />
      </IconButton>
    </nav>

    <div class="flex items-center gap-0.5">
      <IconButton label={t.menu.togglePane} size="sm" aria-pressed={paneOpen} onclick={ontogglepane}>
        {#if paneOpen}<PanelRightClose aria-hidden="true" />{:else}<PanelRightOpen aria-hidden="true" />{/if}
      </IconButton>
      <Menu label={t.menu.label} triggerSize="sm" triggerClass="w-8 px-0">
        {#snippet trigger()}
          <Ellipsis class="size-4" aria-hidden="true" />
        {/snippet}
        {#if wb.canEdit}
          <MenuItem onSelect={onimport}>{t.menu.import}</MenuItem>
          <MenuItem onSelect={onnumber}>{t.menu.numberLines}</MenuItem>
          <MenuItem onSelect={onsettings}>{t.menu.settings}</MenuItem>
          <MenuSeparator />
        {/if}
        <DropdownMenu.Item class={itemClass}>
          {#snippet child({ props })}
            <a {...props} href="/transcriptions/{wb.id}/tei" download data-sveltekit-reload>{t.menu.downloadTei}</a>
          {/snippet}
        </DropdownMenu.Item>
        <MenuItem href="/witnesses/{wb.witness.slug}">{t.menu.witness}</MenuItem>
        {#if oncopy}
          <MenuItem onSelect={oncopy}>{t.menu.copy}</MenuItem>
        {/if}
        {#if wb.canDelete}
          <MenuSeparator />
          <MenuItem danger onSelect={ondelete}>{t.menu.delete}</MenuItem>
        {/if}
      </Menu>
    </div>
  </div>
</div>

{#if wb.canEdit}<TakeFormsDialog {wb} bind:open={takeOpen} />{/if}
