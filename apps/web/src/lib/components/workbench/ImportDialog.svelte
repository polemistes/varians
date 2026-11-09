<script lang="ts">
  /**
   * Import (PLAN 5.5, 5.6, 7.7): TEI by file, URL or CTS URN with the
   * structure mapped onto the work's scheme; plain text with its numbering;
   * Leiden notation; PAGE XML or ALTO with pages and zones. Every import is
   * one change in the history; what is pending is saved first.
   */
  import type { SubmitFunction } from '@sveltejs/kit';
  import { enhance } from '$app/forms';
  import { detectNumbering } from '@varians/core';
  import { untrack } from 'svelte';
  import { UNPLACED } from '$lib/workbench/pages';
  import { Button, buttonClasses, Checkbox, Dialog, Field, Input, Notice, Select, Spinner, TabPanel, Tabs, Textarea, toasts } from '$lib/components/ui';
  import { workbench as t } from '$lib/strings/workbench';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    open: boolean;
  }

  let { wb, open = $bindable(false) }: Props = $props();

  interface TeiPreviewData {
    units: { unit: string; count: number; example: string }[];
    mapping: Record<string, string>;
    resolved: number;
    unresolved: number;
    examples: string[];
    words: number;
    pageBreaks: number;
    title: string | null;
    warnings: string[];
  }

  let tab = $state('tei');
  let replace = $state(false);
  /** Where text without pages of its own goes: Not on a page, or the page shown. */
  let placement = $state<string>(untrack(() => (wb.onPage && wb.page ? wb.page : UNPLACED)));
  const placements = $derived([
    { value: UNPLACED, label: t.importer.placementUnplaced },
    ...(wb.onPage && wb.page ? [{ value: wb.page, label: t.importer.placementPage(wb.pageLabel) }] : []),
  ]);
  $effect(() => {
    if (!placements.some((p) => p.value === placement)) placement = UNPLACED;
  });
  /** The source of the text, to be recorded with the transcription's sources; empty when it is only a starting point. */
  let source = $state('');
  let workId = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let done = $state<{ summary: string; warnings: string[] } | null>(null);

  // TEI
  let teiForm = $state<HTMLFormElement>();
  let teiPreviewButton = $state<HTMLButtonElement>();
  let teiSource = $state('');
  let teiFiles = $state<FileList | undefined>();
  let preview = $state.raw<TeiPreviewData | null>(null);
  let mapping = $state<Record<string, string>>({});

  // Plain text
  let text = $state('');
  let pattern = $state('');
  let startLabel = $state('');
  let paragraphs = $state(false);
  let hyphenJoins = $state(true);
  const patterns = $derived(text.trim() ? detectNumbering(text) : []);

  // Leiden
  let leiden = $state('');

  // PAGE and ALTO
  let layoutFiles = $state<FileList | undefined>();

  const levels = $derived(wb.works.find((w) => w.id === workId)?.levels ?? []);
  const empty = $derived(wb.stream.items.length === 0);

  $effect(() => {
    if (!open) return;
    workId = wb.workId ?? wb.works[0]?.id ?? '';
    error = null;
    done = null;
    busy = false;
  });

  // Offer the best numbering found, and keep the choice while it is still found.
  $effect(() => {
    if (pattern && !patterns.some((p) => p.kind === pattern)) pattern = patterns[0]?.kind ?? '';
    else if (!pattern && patterns.length) pattern = patterns[0]!.kind;
  });

  // A new source needs a new reading.
  $effect(() => {
    void teiSource;
    void teiFiles;
    void workId;
    preview = null;
  });

  async function loadInto(files: FileList | null, set: (value: string) => void) {
    const file = files?.[0];
    if (file) set(await file.text());
  }

  /** Save what is pending, then send the form against the version the server has. */
  const submit: SubmitFunction = async ({ formData, action, cancel }) => {
    error = null;
    done = null;
    const isPreview = action.search.includes('teiPreview');
    if (!isPreview) {
      busy = true;
      await wb.flush();
      if (wb.pending > 0 || wb.saveError) {
        busy = false;
        error = wb.saveError ?? t.importer.conflict;
        cancel();
        return;
      }
    }
    formData.set('fromVersion', String(wb.version));
    formData.set('workId', workId);
    formData.set('replace', replace && !empty ? 'true' : 'false');
    formData.set('placement', placement);
    if (!isPreview) formData.set('source', source);
    // Before the first reading the server proposes the mapping; afterwards it is the one chosen here.
    if ((action.search.includes('Tei') || isPreview) && preview) formData.set('mapping', JSON.stringify(mapping));
    busy = true;
    return async ({ result }) => {
      busy = false;
      if (result.type === 'success') {
        const data = result.data as { teiPreview?: TeiPreviewData; imported?: Parameters<Workbench['applyImport']>[0] & { outcome: { segments: number; pagesMatched: number; pagesCreated: number; zones: number; unplaced: number; warnings: string[] } } };
        if (data.teiPreview) {
          preview = data.teiPreview;
          mapping = { ...data.teiPreview.mapping };
          for (const unit of data.teiPreview.units) if (!(unit.unit in mapping)) mapping[unit.unit] = '';
          return;
        }
        if (data.imported) {
          wb.applyImport(data.imported);
          const summary = t.importer.summary(data.imported.outcome);
          done = { summary: summary || t.importer.done, warnings: data.imported.outcome.warnings };
          toasts.success(summary ? `${t.importer.done} ${summary}.` : t.importer.done);
          preview = null;
          text = '';
          leiden = '';
          replace = false;
          if (done.warnings.length === 0) open = false;
        }
      } else if (result.type === 'failure') {
        const data = result.data as { message?: string; conflict?: boolean } | undefined;
        error = data?.message ?? t.importer.failed('');
        if (data?.conflict) await wb.reload();
      } else if (result.type === 'error') {
        error = t.importer.failed(result.error?.message ?? '');
      }
    };
  };

  function remap(unit: string, level: string) {
    mapping = { ...mapping, [unit]: level };
    if (teiPreviewButton) teiForm?.requestSubmit(teiPreviewButton);
  }

  const tabs = [
    { value: 'tei', label: t.importer.tabs.tei },
    { value: 'text', label: t.importer.tabs.text },
    { value: 'leiden', label: t.importer.tabs.leiden },
    { value: 'layout', label: t.importer.tabs.layout },
  ];
</script>

{#snippet common()}
  {#if wb.works.length > 0 && tab !== 'leiden' && tab !== 'layout'}
    <Field label={t.importer.work}>
      {#snippet children(control)}
        <Select {...control} bind:value={workId} options={[...wb.works.map((w) => ({ value: w.id, label: w.title })), { value: '', label: t.importer.noWork }]} />
      {/snippet}
    </Field>
  {/if}
  {#if wb.pages.length > 0 && tab !== 'layout'}
    <Field label={t.importer.placement} hint={tab === 'tei' ? t.importer.placementTei : undefined}>
      {#snippet children(control)}
        <Select {...control} bind:value={placement} options={placements} />
      {/snippet}
    </Field>
  {/if}
  {#if !empty}
    <Checkbox bind:checked={replace} hint={t.importer.replaceHint}>{t.importer.replace}</Checkbox>
  {/if}
  <Field label={t.importer.source} hint={t.importer.sourceHint}>
    {#snippet children(control)}
      <Input {...control} bind:value={source} maxlength={1000} />
    {/snippet}
  </Field>
{/snippet}

{#snippet outcome()}
  {#if error}<Notice kind="error">{error}</Notice>{/if}
  {#if done}
    <Notice kind="success" title={done.summary}>
      {#if done.warnings.length}
        <p class="font-medium">{t.importer.warnings}</p>
        <ul class="mt-1 list-disc pl-5">
          {#each done.warnings as warning, i (i)}<li>{warning}</li>{/each}
        </ul>
      {/if}
    </Notice>
  {/if}
{/snippet}

<Dialog bind:open title={t.importer.title} description={t.importer.description} size="lg">
  <Tabs {tabs} bind:value={tab} label={t.importer.title}>
    <TabPanel value="tei">
      <form bind:this={teiForm} method="post" action="?/importTei" enctype="multipart/form-data" use:enhance={submit} class="flex flex-col gap-4">
        <div class="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
          <Field label={t.importer.file}>
            {#snippet children(control)}
              <input {...control} type="file" name="file" accept=".xml,.tei,application/xml,text/xml" bind:files={teiFiles} class="text-sm text-ink-soft file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:text-sm file:font-medium file:text-ink hover:file:bg-sunken" />
            {/snippet}
          </Field>
          <span class="pb-2 text-center text-xs text-ink-muted">{t.importer.or}</span>
          <Field label={t.importer.tei.source}>
            {#snippet children(control)}
              <Input {...control} name="source" bind:value={teiSource} autocomplete="off" />
            {/snippet}
          </Field>
        </div>
        <p class="-mt-2 text-xs text-ink-soft">{t.importer.tei.sourceHint}</p>
        {@render common()}
        <div>
          <button
            type="submit"
            class={buttonClasses('secondary', 'sm')}
            formaction="?/teiPreview"
            bind:this={teiPreviewButton}
            disabled={busy || (!teiSource.trim() && !teiFiles?.length)}
          >
            {#if busy && !preview}<Spinner size="sm" />{t.importer.tei.reading}{:else}{t.importer.tei.preview}{/if}
          </button>
        </div>
        {#if preview}
          <div class="flex flex-col gap-3 rounded-md border border-line p-3">
            <p class="text-sm text-ink-soft">
              {[preview.title ? t.importer.tei.titleFound(preview.title) : null, t.importer.tei.words(preview.words), t.importer.tei.pageBreaks(preview.pageBreaks)]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {#if preview.units.length && levels.length}
              <table class="w-full text-sm">
                <caption class="mb-1 text-left text-xs font-medium text-ink-soft">{t.importer.tei.structure}</caption>
                <thead class="text-left text-xs text-ink-muted">
                  <tr>
                    <th class="py-1 font-medium">{t.importer.tei.unit}</th>
                    <th class="py-1 font-medium">{t.importer.tei.count}</th>
                    <th class="py-1 font-medium">{t.importer.tei.example}</th>
                    <th class="py-1 font-medium">{t.importer.tei.level}</th>
                  </tr>
                </thead>
                <tbody>
                  {#each preview.units as unit (unit.unit)}
                    <tr class="border-t border-line">
                      <td class="py-1 font-mono text-xs">{unit.unit}</td>
                      <td class="py-1">{unit.count}</td>
                      <td class="py-1 font-serif">{unit.example}</td>
                      <td class="py-1">
                        <select
                          class="h-8 rounded-md border border-line bg-surface px-2 text-sm"
                          aria-label={`${t.importer.tei.level}: ${unit.unit}`}
                          value={mapping[unit.unit] ?? ''}
                          onchange={(event) => remap(unit.unit, event.currentTarget.value)}
                        >
                          <option value="">{t.importer.tei.ignore}</option>
                          {#each levels as level (level.key)}
                            <option value={level.key}>{level.label}</option>
                          {/each}
                        </select>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
              <p class="text-sm">
                {t.importer.tei.resolved(preview.resolved, preview.resolved + preview.unresolved)}{#if preview.examples.length}, {t.importer.tei.examples(preview.examples.join(', '))}{/if}
              </p>
            {/if}
            {#if preview.warnings.length}
              <ul class="list-disc pl-5 text-xs text-ink-soft">
                {#each preview.warnings.slice(0, 8) as warning, i (i)}<li>{warning}</li>{/each}
              </ul>
            {/if}
          </div>
        {/if}
        {@render outcome()}
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onclick={() => (open = false)}>{t.importer.cancel}</Button>
          <Button type="submit" variant="primary" loading={busy && !!preview} disabled={busy || !preview}>{t.importer.run}</Button>
        </div>
      </form>
    </TabPanel>

    <TabPanel value="text">
      <form method="post" action="?/importText" use:enhance={submit} class="flex flex-col gap-4">
        <Field label={t.importer.text.text}>
          {#snippet children(control)}
            <Textarea {...control} name="text" rows={8} serif bind:value={text} />
          {/snippet}
        </Field>
        <input type="file" accept=".txt,text/plain" class="text-sm text-ink-soft file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:text-sm file:font-medium file:text-ink hover:file:bg-sunken" aria-label={t.importer.file} onchange={(e) => loadInto(e.currentTarget.files, (v) => (text = v))} />
        <fieldset class="flex flex-col gap-1.5">
          <legend class="mb-1 text-sm font-medium">{t.importer.text.numbering}</legend>
          <label class="flex items-center gap-2 text-sm">
            <input type="radio" name="pattern" value="" bind:group={pattern} />
            {t.importer.text.none}
          </label>
          {#each patterns as option (option.kind)}
            <label class="flex items-baseline gap-2 text-sm">
              <input type="radio" name="pattern" value={option.kind} bind:group={pattern} />
              <span>{t.importer.text.kinds[option.kind] ?? option.kind}</span>
              <span class="text-xs text-ink-soft">{t.importer.text.matches(option.matches, option.sample)}</span>
            </label>
          {/each}
        </fieldset>
        {#if pattern === 'every-line' || pattern === 'margin-every-n'}
          <Field label={t.importer.text.start} hint={t.importer.text.startHint}>
            {#snippet children(control)}
              <Input {...control} name="startLabel" bind:value={startLabel} autocomplete="off" class="w-40 font-serif" />
            {/snippet}
          </Field>
        {/if}
        <div class="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox name="paragraphs" bind:checked={paragraphs}>{t.importer.text.paragraphs}</Checkbox>
          <Checkbox name="hyphenJoins" bind:checked={hyphenJoins}>{t.importer.text.hyphens}</Checkbox>
        </div>
        {@render common()}
        {@render outcome()}
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onclick={() => (open = false)}>{t.importer.cancel}</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={busy || !text.trim()}>{t.importer.run}</Button>
        </div>
      </form>
    </TabPanel>

    <TabPanel value="leiden">
      <form method="post" action="?/importLeiden" use:enhance={submit} class="flex flex-col gap-4">
        <Field label={t.importer.leiden.text} hint={t.importer.leiden.hint}>
          {#snippet children(control)}
            <Textarea {...control} name="text" rows={8} serif bind:value={leiden} />
          {/snippet}
        </Field>
        <input type="file" accept=".txt,text/plain" class="text-sm text-ink-soft file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:text-sm file:font-medium file:text-ink hover:file:bg-sunken" aria-label={t.importer.file} onchange={(e) => loadInto(e.currentTarget.files, (v) => (leiden = v))} />
        {@render common()}
        {@render outcome()}
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onclick={() => (open = false)}>{t.importer.cancel}</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={busy || !leiden.trim()}>{t.importer.run}</Button>
        </div>
      </form>
    </TabPanel>

    <TabPanel value="layout">
      <form method="post" action="?/importLayout" enctype="multipart/form-data" use:enhance={submit} class="flex flex-col gap-4">
        <Field label={t.importer.layout.file} hint={t.importer.layout.hint}>
          {#snippet children(control)}
            <input {...control} type="file" name="file" accept=".xml,application/xml,text/xml" bind:files={layoutFiles} class="text-sm text-ink-soft file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:text-sm file:font-medium file:text-ink hover:file:bg-sunken" />
          {/snippet}
        </Field>
        <p class="text-xs text-ink-soft">{wb.canMaintainWitness ? t.importer.layout.createPages : t.importer.layout.noCreatePages}</p>
        {@render common()}
        {@render outcome()}
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onclick={() => (open = false)}>{t.importer.cancel}</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={busy || !layoutFiles?.length}>{t.importer.run}</Button>
        </div>
      </form>
    </TabPanel>
  </Tabs>
</Dialog>
