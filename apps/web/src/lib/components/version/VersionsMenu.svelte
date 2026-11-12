<script lang="ts">
  /**
   * The Versions menu of the reader and of the workbench: the versions,
   * newest first, each with its number, its date and its note, the latest and
   * the withdrawn ones marked, and under each What Changed, which opens the
   * changes since the version before. What follows (the draft, for those who
   * may edit) is the page's own.
   */
  import type { Snippet } from 'svelte';
  import History from '@lucide/svelte/icons/history';
  import {
    Button,
    Dialog,
    LocalDate,
    Menu,
    MenuItem,
    MenuLabel,
    MenuSeparator,
  } from '$lib/components/ui';
  import type { ReaderVersion } from '$lib/reader/types';
  import { s } from '$lib/strings';
  import { versions as v } from '$lib/strings/versions';
  import VersionChangesList from './VersionChangesList.svelte';

  interface Props {
    versions: ReaderVersion[];
    /** Items after the versions, after a separator: the draft for its editors. */
    after?: Snippet;
    /** The label beside the icon is shown from this width on. */
    triggerClass?: string;
  }

  let { versions, after, triggerClass = 'px-2' }: Props = $props();

  let shown = $state<ReaderVersion | null>(null);
  let changesOpen = $state(false);

  function whatChanged(version: ReaderVersion) {
    shown = version;
    changesOpen = true;
  }
</script>

<Menu label={v.menu.label} triggerSize="sm" {triggerClass} class="max-w-sm min-w-64">
  {#snippet trigger()}
    <History class="size-4 text-ink-soft" aria-hidden="true" />
    <span class="hidden text-ink-soft md:inline">{v.menu.label}</span>
  {/snippet}
  <MenuLabel>{v.menu.label}</MenuLabel>
  {#each versions as version (version.number)}
    <MenuItem href={version.href}>
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="flex items-baseline gap-2">
          <span class={['font-medium', version.withdrawn && 'text-ink-soft']}
            >{v.version(version.number)}</span
          >
          <LocalDate date={version.at} class="text-xs text-ink-muted" />
          {#if version.current}<span class="text-xs text-success">{v.menu.current}</span>{/if}
          {#if version.withdrawn}<span class="text-xs text-danger">{v.menu.withdrawn}</span>{/if}
        </span>
        {#if version.note}<span class="line-clamp-2 text-xs whitespace-normal text-ink-soft"
            >{version.note}</span
          >{/if}
      </span>
    </MenuItem>
    <MenuItem class="py-1 pl-5 text-xs text-ink-soft" onSelect={() => whatChanged(version)}>
      {v.menu.whatChanged}
    </MenuItem>
  {:else}
    <MenuItem disabled>{v.menu.none}</MenuItem>
  {/each}
  {#if after}
    <MenuSeparator />
    {@render after()}
  {/if}
</Menu>

{#if shown}
  <Dialog bind:open={changesOpen} title={v.menu.whatChangedOf(shown.number)} size="md">
    <div class="space-y-3">
      <p class="text-ink-soft">
        {v.published(shown.number)}
        <LocalDate date={shown.at} />{#if shown.withdrawn}; {v.menu.withdrawn}
          <LocalDate date={shown.withdrawn.at} />{/if}.
      </p>
      {#if shown.note}<p class="whitespace-pre-line">{shown.note}</p>{/if}
      <VersionChangesList changes={shown.changes} open />
    </div>
    {#snippet footer()}
      <Button variant="ghost" onclick={() => (changesOpen = false)}>{s.common.close}</Button>
    {/snippet}
  </Dialog>
{/if}
