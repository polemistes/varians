<script lang="ts">
  /**
   * The history panel's development page: the current text of a sample
   * document beside the panel, with a few buttons that save small changes
   * through the save endpoint, to watch the panel follow the document.
   */
  import { goto } from '$app/navigation';
  import { newId, type Op, type Stream, type Token } from '@varians/core';
  import { HistoryPanel, StreamView } from '$lib/components/history';
  import { Button, Notice, Select, toasts } from '$lib/components/ui';
  import { historyStrings as t } from '$lib/strings/history';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const selectedValue = $derived(`${data.selected.kind}:${data.selected.id}`);
  const options = $derived(data.documents.map((d) => ({ value: `${d.kind}:${d.id}`, label: d.label })));
  const endpoint = $derived(`/api/documents/${data.selected.kind}/${data.selected.id}/ops`);

  let version = $state(0);
  let content = $state.raw<Stream | null>(null);
  let saving = $state(false);

  async function reload() {
    const response = await fetch(endpoint);
    if (!response.ok) return;
    const document = (await response.json()) as { version: number; content: Stream };
    version = document.version;
    content = document.content;
  }

  $effect(() => {
    void endpoint;
    void reload();
  });

  function pick(): Token | null {
    const tokens = (content?.items ?? []).filter((i): i is Token => i.kind === 'token');
    return tokens.length ? tokens[Math.floor(Math.random() * tokens.length)]! : null;
  }

  async function change(what: 'respell' | 'insert' | 'remove') {
    const token = pick();
    if (!token) return;
    const ops: Op[] =
      what === 'respell'
        ? [{ t: 'set', id: token.id, fields: { form: token.form.endsWith('·') ? token.form.slice(0, -1) : `${token.form}·` } }]
        : what === 'insert'
          ? [{ t: 'insert', after: token.id, items: [{ kind: 'token', id: newId(), form: t.dev.added, source: { kind: 'editor' } }] }]
          : [{ t: 'delete', ids: [token.id] }];
    saving = true;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromVersion: version, ops }),
      });
      if (!response.ok && response.status !== 409) toasts.error(t.dev.failed);
      await reload();
    } finally {
      saving = false;
    }
  }

  function choose(value: string) {
    const [kind, id] = value.split(':');
    void goto(`?kind=${kind}&id=${id}`);
  }
</script>

<div class="mx-auto flex max-w-page flex-col gap-8 px-6 py-8 lg:flex-row lg:items-start">
  <div class="min-w-0 flex-1 space-y-4">
    <div>
      <h1 class="text-title font-serif text-ink">{t.dev.title}</h1>
      <p class="mt-1 max-w-reading text-sm text-ink-soft">{t.dev.intro}</p>
    </div>
    <label class="block max-w-sm">
      <span class="mb-1 block text-xs text-ink-soft">{t.dev.document}</span>
      <Select value={selectedValue} {options} onchange={(event) => choose(event.currentTarget.value)} />
    </label>
    {#if data.selected.canEdit}
      <div class="flex flex-wrap gap-2">
        <Button size="sm" disabled={saving} onclick={() => change('respell')}>{t.dev.respell}</Button>
        <Button size="sm" disabled={saving} onclick={() => change('insert')}>{t.dev.insert}</Button>
        <Button size="sm" disabled={saving} onclick={() => change('remove')}>{t.dev.remove}</Button>
      </div>
    {:else}
      <Notice>{t.dev.readOnly}</Notice>
    {/if}
    <section class="rounded-md border border-line bg-surface p-4" aria-label={t.dev.current(version)}>
      <p class="mb-3 font-sans text-xs text-ink-muted">{t.dev.current(version)}</p>
      {#if content}
        <StreamView stream={content} labelOf={data.labels} numberEvery={data.numberEvery} />
      {/if}
    </section>
  </div>
  <!-- A side pane of fixed height, as an editor gives it: the panel scrolls inside. -->
  <aside class="h-[36rem] shrink-0 lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)] lg:border-l lg:border-line lg:pl-6">
    {#key selectedValue}
      <HistoryPanel
        kind={data.selected.kind}
        documentId={data.selected.id}
        currentVersion={version}
        labelOf={data.labels}
        canEdit={data.selected.canEdit}
        onchanged={reload}
        numberEvery={data.numberEvery}
      />
    {/key}
  </aside>
</div>
