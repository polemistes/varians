<script lang="ts">
  /**
   * The Pages tab of the side pane: every page of the witness as a card,
   * the one shown in the text marked; a click on a card goes to that page.
   * For the maintainers of the witness the pages are managed here as on the
   * witness's pages screen: images added, pages added by their labels, a
   * IIIF manifest imported, and each card's menu. The changes go to that
   * screen's form actions; after each the list is read again, and the text
   * too, since a page removed or moved moves text. Each card
   * says whether the page has text in this transcript, and how many lines.
   */
  import { onMount, tick } from 'svelte';
  import X from '@lucide/svelte/icons/x';
  import AddPagesForm from '$lib/components/pages/AddPagesForm.svelte';
  import ManifestImport from '$lib/components/pages/ManifestImport.svelte';
  import PageGrid from '$lib/components/pages/PageGrid.svelte';
  import UploadImages from '$lib/components/pages/UploadImages.svelte';
  import type { PageView, WitnessPagesData } from '$lib/components/pages/types';
  import { Button, EmptyState, IconButton, Spinner } from '$lib/components/ui';
  import { pageStrings as t } from '$lib/strings/pages';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
  }

  let { wb }: Props = $props();

  type Tool = 'upload' | 'add';

  let info = $state<WitnessPagesData['witness'] | null>(null);
  let failed = $state(false);
  let tool = $state<Tool | null>(null);
  let grid = $state<HTMLElement | null>(null);

  const pages = $derived<PageView[] | null>(wb.pageViews);
  const loading = $derived(pages === null && !failed);
  const canMaintain = $derived(wb.canMaintainWitness);
  const withImage = $derived((pages ?? []).filter((p) => p.imageKind).length);
  const lastLabel = $derived(pages?.at(-1)?.label ?? null);

  async function load(): Promise<void> {
    failed = false;
    const data = await wb.refreshPages();
    if (!data) {
      failed = true;
      return;
    }
    info = data.witness;
  }

  /** After a change: the text first (the server may have moved it), then the pages, so that no page break outlives its page's label. */
  async function changed(): Promise<void> {
    await wb.reload();
    await load();
  }

  /** What a card says of the page's text in this transcript. */
  function textOf(page: PageView): string {
    const text = wb.textOnPages.get(page.id);
    return text ? t.card.lines(text.lines) : t.card.noText;
  }

  onMount(() => {
    void load();
  });

  function toggle(which: Tool) {
    tool = tool === which ? null : which;
  }

  // The card of the page shown is kept in view when the tab opens and when the page changes.
  $effect(() => {
    const id = wb.pageId;
    const ready = pages !== null;
    if (!id || !ready) return;
    void tick().then(() => {
      grid?.querySelector(`[data-page-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  });
</script>

<div class="flex h-full min-h-0 flex-col font-sans">
  <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-sm">
    <p class="min-w-0 flex-1 truncate text-ink-soft" aria-live="polite">
      {#if pages}{t.summary(pages.length, withImage)}{/if}
    </p>
    {#if canMaintain && pages}
      <Button size="sm" variant={tool === 'upload' ? 'primary' : 'secondary'} aria-pressed={tool === 'upload'} onclick={() => toggle('upload')}>
        {t.panel.addImages}
      </Button>
      <Button size="sm" variant={tool === 'add' ? 'primary' : 'secondary'} aria-pressed={tool === 'add'} onclick={() => toggle('add')}>
        {t.panel.addPages}
      </Button>
      <ManifestImport manifestUrl={info?.iiifManifest ?? null} hasPages={pages.length > 0} base={wb.pagesBase} onchanged={changed} size="sm" />
    {/if}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto p-3" bind:this={grid}>
    {#if canMaintain && tool && pages}
      <div class="relative mb-4">
        {#if tool === 'upload'}
          <UploadImages {lastLabel} defaults={wb.imageDefaults} maxBytes={wb.maxUploadBytes} base={wb.pagesBase} onchanged={changed} />
        {:else}
          <AddPagesForm roll={info?.roll ?? false} base={wb.pagesBase} onchanged={changed} />
        {/if}
        <IconButton label={t.panel.close} size="sm" class="absolute top-2.5 right-2.5" onclick={() => (tool = null)}>
          <X aria-hidden="true" />
        </IconButton>
      </div>
    {/if}

    {#if loading}
      <div class="flex justify-center py-10 text-ink-soft"><Spinner label={t.panel.loading} /></div>
    {:else if failed}
      <EmptyState description={t.panel.failed}>
        <Button size="sm" onclick={load}>{t.panel.retry}</Button>
      </EmptyState>
    {:else if pages && pages.length === 0}
      <EmptyState title={t.panel.empty} description={canMaintain ? t.panel.emptyHint : t.panel.emptyReadOnly} />
    {:else if pages}
      <PageGrid
        {pages}
        maxUploadBytes={wb.maxUploadBytes}
        defaults={wb.imageDefaults}
        readonly={!canMaintain}
        current={wb.pageId}
        base={wb.pagesBase}
        onchanged={changed}
        onopen={(page) => wb.goTo(page.id)}
        {textOf}
      />
      {#if !canMaintain}
        <p class="mt-4 text-xs text-ink-muted">{t.panel.readOnly}</p>
      {/if}
    {/if}
  </div>
</div>
