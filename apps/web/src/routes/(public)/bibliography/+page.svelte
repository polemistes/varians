<script lang="ts">
  import Download from '@lucide/svelte/icons/download';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Plus from '@lucide/svelte/icons/plus';
  import Upload from '@lucide/svelte/icons/upload';
  import DeleteDialog from '$lib/components/bibliography/DeleteDialog.svelte';
  import EntryDialog from '$lib/components/bibliography/EntryDialog.svelte';
  import ImportDialog from '$lib/components/bibliography/ImportDialog.svelte';
  import Reference from '$lib/components/bibliography/Reference.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { Button, EmptyState, Menu, MenuItem } from '$lib/components/ui';
  import { bibStrings as t } from '$lib/strings/bibliography';
  import { site } from '$lib/strings/site';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  let entryOpen = $state(false);
  let importOpen = $state(false);
  let deleteOpen = $state(false);
  let editing = $state<{ id: string; bib: string } | null>(null);
  let deleting = $state<{ id: string; label: string } | null>(null);

  function pageHref(page: number): string {
    const params = new URLSearchParams();
    if (data.q) params.set('q', data.q);
    if (page > 1) params.set('page', String(page));
    const search = params.toString();
    return search ? `/bibliography?${search}` : '/bibliography';
  }
</script>

<PageFrame title={t.title}>
  {#snippet actions()}
    {#if data.canAdd}
      <Button
        variant="secondary"
        size="sm"
        onclick={() => {
          editing = null;
          entryOpen = true;
        }}
      >
        <Plus class="size-4" aria-hidden="true" />
        {t.add}
      </Button>
      <Button variant="secondary" size="sm" onclick={() => (importOpen = true)}>
        <Upload class="size-4" aria-hidden="true" />
        {t.import}
      </Button>
    {/if}
    <Button variant="ghost" size="sm" href="/bibliography.bib" data-sveltekit-reload>
      <Download class="size-4" aria-hidden="true" />
      {t.download}
    </Button>
  {/snippet}

  <div class="flex flex-col gap-6">
    {#if data.q || data.total}
      <!-- The header's search leads here with a query; the list is then the matching entries. -->
      <p class="flex flex-wrap items-baseline gap-x-3 font-sans text-sm text-ink-soft">
        {#if data.q}
          <span>{site.search.resultsFor(data.q)}</span>
          <a href="/bibliography" class="text-accent hover:underline">{t.clear}</a>
        {/if}
        {#if data.total}<span class="ml-auto text-xs text-ink-muted">{t.count(data.items.length, data.total)}</span>{/if}
      </p>
    {/if}

    {#if data.items.length === 0}
      {#if data.q}
        <p class="font-sans text-sm text-ink-soft">{t.noResults(data.q)}</p>
      {:else}
        <EmptyState title={t.empty} />
      {/if}
    {:else}
      <ul class="flex flex-col divide-y divide-line">
        {#each data.items as item (item.id)}
          <li class="flex items-start gap-4 py-3" id="bib-{item.key}">
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <div class="flex flex-wrap items-baseline gap-x-3 font-sans">
                <span class="text-sm font-semibold text-ink">{item.label}</span>
                <span class="font-mono text-xs text-ink-muted">{item.key}</span>
              </div>
              <Reference pieces={item.pieces} class="text-[0.95rem] leading-snug text-ink" />
              <span class="font-sans text-xs text-ink-muted">{t.cited(item.cited)}</span>
            </div>
            {#if item.canEdit}
              <Menu label={t.actions(item.label)} triggerSize="sm">
                {#snippet trigger()}<Ellipsis class="size-4" aria-hidden="true" />{/snippet}
                <MenuItem
                  onSelect={() => {
                    editing = { id: item.id, bib: item.bib };
                    entryOpen = true;
                  }}>{t.edit}</MenuItem
                >
                {#if item.canDelete}
                  <MenuItem
                    danger
                    onSelect={() => {
                      deleting = { id: item.id, label: item.label };
                      deleteOpen = true;
                    }}>{t.remove}</MenuItem
                  >
                {/if}
              </Menu>
            {/if}
          </li>
        {/each}
      </ul>
      {#if data.pages > 1}
        <nav class="flex items-center justify-between font-sans text-sm" aria-label={t.page(data.page, data.pages)}>
          {#if data.page > 1}<Button variant="ghost" size="sm" href={pageHref(data.page - 1)}>{t.previous}</Button>{:else}<span></span>{/if}
          <span class="text-ink-muted">{t.page(data.page, data.pages)}</span>
          {#if data.page < data.pages}<Button variant="ghost" size="sm" href={pageHref(data.page + 1)}>{t.next}</Button>{:else}<span></span>{/if}
        </nav>
      {/if}
    {/if}
  </div>
</PageFrame>

<EntryDialog bind:open={entryOpen} entry={editing} />
<ImportDialog bind:open={importOpen} />
<DeleteDialog bind:open={deleteOpen} entry={deleting} />
