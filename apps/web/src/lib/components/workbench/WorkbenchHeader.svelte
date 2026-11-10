<script lang="ts">
  /**
   * The workbench's header: the witness and the
   * transcript, and at the right the side pane's toggle and the menu of
   * whole-text actions, with the side the facsimile stands on. The page
   * chooser and the text's tools are in the bar above the text.
   */
  import { DropdownMenu } from 'bits-ui';
  import Check from '@lucide/svelte/icons/check';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
  import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
  import PanelRightClose from '@lucide/svelte/icons/panel-right-close';
  import PanelRightOpen from '@lucide/svelte/icons/panel-right-open';
  import { Badge, IconButton, Menu, MenuItem, MenuSeparator } from '$lib/components/ui';
  import { workbench as t } from '$lib/strings/workbench';
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
    /** The side pane stands left of the text. */
    paneLeft: boolean;
    onpaneleft: (left: boolean) => void;
  }

  let {
    wb,
    paneOpen,
    ontogglepane,
    onimport,
    onsettings,
    ondelete,
    onnumber,
    oncopy,
    paneLeft,
    onpaneleft,
  }: Props = $props();

  const itemClass =
    'flex w-full cursor-default items-center gap-2 rounded px-2 py-1.5 text-left text-ink outline-none select-none data-highlighted:bg-sunken data-disabled:pointer-events-none data-disabled:opacity-50';
</script>

<div
  class="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-1.5 font-sans text-sm"
>
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
    <div class="flex items-center gap-0.5">
      <IconButton
        label={t.menu.togglePane}
        size="sm"
        aria-pressed={paneOpen}
        onclick={ontogglepane}
      >
        {#if paneLeft}
          {#if paneOpen}<PanelLeftClose aria-hidden="true" />{:else}<PanelLeftOpen
              aria-hidden="true"
            />{/if}
        {:else if paneOpen}<PanelRightClose aria-hidden="true" />{:else}<PanelRightOpen
            aria-hidden="true"
          />{/if}
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
            <a {...props} href="/transcriptions/{wb.id}/tei" download data-sveltekit-reload
              >{t.menu.downloadTei}</a
            >
          {/snippet}
        </DropdownMenu.Item>
        <MenuItem href="/witnesses/{wb.witness.slug}">{t.menu.witness}</MenuItem>
        <DropdownMenu.CheckboxItem
          class={itemClass}
          checked={paneLeft}
          onCheckedChange={(checked) => onpaneleft(checked)}
        >
          {#snippet children({ checked })}
            <span class="flex w-4 justify-center"
              >{#if checked}<Check class="size-3.5" aria-hidden="true" />{/if}</span
            >
            <span>{t.menu.paneLeft}</span>
          {/snippet}
        </DropdownMenu.CheckboxItem>
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
