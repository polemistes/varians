<script lang="ts">
  /**
   * The side pane (PLAN 6.2): the facsimile of the page, the other form of
   * the text (read only, the caret's word lit in both), the history, and the
   * pages of the witness, chosen by a tab. The history panel is loaded when
   * it exists.
   */
  import { onMount, type Component } from 'svelte';
  import { Tabs } from 'bits-ui';
  import TextEditor from '$lib/components/editor/TextEditor.svelte';
  import type { EditorApi } from '$lib/editor/editor';
  import { asWrittenLines } from '$lib/workbench/view';
  import { workbench as t } from '$lib/strings/workbench';
  import FacsimilePane from './FacsimilePane.svelte';
  import PagesPanel from './PagesPanel.svelte';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    tab: string;
  }

  let { wb, tab = $bindable('facsimile') }: Props = $props();

  // The history panel is written elsewhere; the pane works without it.
  const historyModules = import.meta.glob('/src/lib/components/history/HistoryPanel.svelte');
  const loadHistory = historyModules['/src/lib/components/history/HistoryPanel.svelte'] as (() => Promise<unknown>) | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let HistoryPanel = $state<Component<any> | null>(null);

  onMount(() => {
    if (!loadHistory) return;
    void loadHistory().then((module) => {
      HistoryPanel = (module as { default: Component<Record<string, unknown>> }).default;
    });
  });

  const tabs = $derived([
    { value: 'facsimile', label: t.pane.facsimile },
    ...(wb.keepsWrittenForm ? [{ value: 'other', label: t.pane.otherForm }] : []),
    ...(loadHistory ? [{ value: 'history', label: t.pane.history }] : []),
    { value: 'pages', label: t.pane.pages },
  ]);

  $effect(() => {
    if (!tabs.some((x) => x.value === tab)) tab = 'facsimile';
  });

  let otherApi = $state.raw<EditorApi | null>(null);
  const caretClasses = $derived(Object.fromEntries(wb.focusTokens.map((id) => [id, 'wb-lit'])));
  const asWritten = $derived(wb.displayAsWritten && wb.otherForm === 'written');
  const writtenLines = $derived(asWritten ? asWrittenLines(wb.pageStream) : []);

  // The other form follows the caret.
  $effect(() => {
    const caret = wb.selection.caret;
    if (caret && otherApi) otherApi.scrollToToken(caret);
  });

</script>

<Tabs.Root bind:value={tab} class="flex h-full min-h-0 flex-col bg-surface">
  <Tabs.List class="flex shrink-0 gap-1 border-b border-line px-2 font-sans text-sm" aria-label={t.pane.label}>
    {#each tabs as item (item.value)}
      <Tabs.Trigger
        value={item.value}
        class="-mb-px border-b-2 border-transparent px-3 py-2 text-ink-soft transition-colors hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink"
      >
        {item.label}
      </Tabs.Trigger>
    {/each}
  </Tabs.List>
  <!-- A tab's content lives only while it is shown: the hidden ones would follow every keystroke and save. -->
  <Tabs.Content value="facsimile" class="min-h-0 flex-1 outline-none">
    {#if tab === 'facsimile'}<FacsimilePane {wb} onpages={() => (tab = 'pages')} />{/if}
  </Tabs.Content>
  <Tabs.Content value="pages" class="min-h-0 flex-1 outline-none">
    {#if tab === 'pages'}<PagesPanel {wb} />{/if}
  </Tabs.Content>
  {#if wb.keepsWrittenForm}
    <Tabs.Content value="other" class="flex min-h-0 flex-1 flex-col outline-none">
      {#if tab === 'other'}
      <p class="shrink-0 px-4 pt-2 font-sans text-xs text-ink-muted">
        {asWritten ? t.pane.asWritten : wb.otherForm === 'written' ? t.pane.otherWritten : t.pane.otherRead}
      </p>
      {#if asWritten}
        <div class="min-h-0 flex-1 overflow-auto px-4 py-3 font-serif text-[1.1rem] leading-[1.7] break-all">
          {#each writtenLines as line, i (i)}<div>{line || ' '}</div>{/each}
        </div>
      {:else}
        <div class="min-h-0 flex-1">
          <TextEditor
            stream={wb.stream}
            form={wb.otherForm}
            readonly
            page={wb.page}
            segmentLabels={wb.segmentLabels}
            pageLabels={wb.pageLabels}
            tokenClasses={caretClasses}
            bind:api={otherApi}
          />
        </div>
      {/if}
      {/if}
    </Tabs.Content>
  {/if}
  {#if loadHistory}
    <Tabs.Content value="history" class="min-h-0 flex-1 overflow-auto outline-none">
      {#if HistoryPanel && tab === 'history'}
        <HistoryPanel
          kind="transcription"
          documentId={wb.id}
          currentVersion={wb.version}
          labelOf={wb.segmentLabels}
          canEdit={wb.canEdit}
          onchanged={() => wb.reload()}
          numberEvery={1}
        />
      {/if}
    </Tabs.Content>
  {/if}
</Tabs.Root>
