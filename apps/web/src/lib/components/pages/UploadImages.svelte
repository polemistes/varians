<script lang="ts">
  /**
   * New pages from images, one page per file in the order of the file names.
   * Labels come from the file names or, when the last page has a folio or a
   * number for a label, continue it. With script, files are dropped or chosen
   * into a list and sent one by one, each with its progress and its error;
   * without, the form posts them all at once.
   */
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import Check from '@lucide/svelte/icons/check';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import ImagePlus from '@lucide/svelte/icons/image-plus';
  import X from '@lucide/svelte/icons/x';
  import { Button, Notice, Spinner, toasts } from '$lib/components/ui';
  import { pageStrings as t } from '$lib/strings/pages';
  import { actionUrl, failureMessage, megabytes, uploadToAction, type Upload } from './client';
  import { ACCEPT_IMAGES, isImageFile } from './files';
  import { compareNames, labelFromFileName, labelsAfter, sortByName } from './labels';

  type EntryState = 'queued' | 'uploading' | 'processing' | 'done' | 'failed';

  interface Entry {
    key: number;
    file: File;
    /** Set when its upload starts; proposed until then. */
    label: string | null;
    state: EntryState;
    progress: number;
    message: string | null;
  }

  interface NoScriptResult {
    ok: boolean;
    message?: string;
    error?: string;
    failed?: { name: string; error: string }[];
  }

  interface Props {
    /** The label of the last page, which a sequence continues. */
    lastLabel: string | null;
    maxBytes: number;
    /** The upload action's answer when the form was sent without script. */
    result?: NoScriptResult | null;
    /** The pages screen whose form actions receive the files; the current page when empty. */
    base?: string;
    /** After each page added: the list is loaded again. */
    onchanged?: () => Promise<void> | void;
  }

  let { lastLabel, maxBytes, result = null, base = '', onchanged = invalidateAll }: Props = $props();

  let scripted = $state(false);
  let entries = $state<Entry[]>([]);
  let mode = $state<'names' | 'sequence'>('sequence');
  let running = $state(false);
  let dragging = $state(false);
  let input = $state<HTMLInputElement | null>(null);
  let current: Upload | null = null;
  /** The label of the file being sent, which the proposals for the rest follow. */
  let inFlight = $state<string | null>(null);
  let stopping = false;
  let sequenceKey = 0;

  onMount(() => {
    scripted = true;
  });

  const maxMb = $derived(megabytes(maxBytes));
  /** The labels that follow the last page, when it has a folio or a number. */
  const canContinue = $derived(labelsAfter(lastLabel, 0) !== null);
  const continueExample = $derived(labelsAfter(lastLabel, 3));
  const pending = $derived(entries.filter((e) => e.state === 'queued'));
  const proposed = $derived.by(() => {
    const names = pending.map((e) => labelFromFileName(e.file.name));
    if (mode === 'sequence' && canContinue) return labelsAfter(inFlight ?? lastLabel, pending.length) ?? names;
    return names;
  });

  function labelOf(entry: Entry): string {
    if (entry.label) return entry.label;
    const i = pending.indexOf(entry);
    return i >= 0 ? (proposed[i] ?? labelFromFileName(entry.file.name)) : labelFromFileName(entry.file.name);
  }

  function add(files: FileList | File[] | null | undefined) {
    if (!files || files.length === 0) return;
    const fresh: Entry[] = sortByName([...files]).map((file) => {
      const problem = !isImageFile(file) ? t.upload.notImage : file.size > maxBytes ? t.upload.tooLarge(maxMb) : null;
      return {
        key: ++sequenceKey,
        file,
        label: null,
        state: problem ? 'failed' : 'queued',
        progress: 0,
        message: problem,
      };
    });
    if (running) {
      entries = [...entries, ...fresh];
      return;
    }
    // A new choice starts a new list; files not sent yet stay, all in the order of their names.
    const waiting = entries.filter((e) => e.state === 'queued');
    entries = [...waiting, ...fresh].sort((a, b) => compareNames(a.file.name, b.file.name));
  }

  function chosen(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    add(target.files);
    // Emptied, so that the same files can be chosen again and the form sends nothing itself.
    target.value = '';
  }

  function dropped(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    add(event.dataTransfer?.files);
  }

  function dragover(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    dragging = true;
  }

  function leave(event: DragEvent) {
    const next = event.relatedTarget as Node | null;
    if (!next || !(event.currentTarget as Node).contains(next)) dragging = false;
  }

  function forget(entry: Entry) {
    entries = entries.filter((e) => e !== entry);
  }

  function clear() {
    entries = [];
  }

  async function start(event: SubmitEvent) {
    event.preventDefault();
    if (running) return;
    const queue = entries.filter((e) => e.state === 'queued');
    if (queue.length === 0) {
      if (entries.length === 0) input?.click();
      return;
    }
    running = true;
    stopping = false;
    const sequence = mode === 'sequence' && canContinue;
    // The label a sequence continues: the last page actually added, so that a file that fails leaves no gap.
    let cursor = lastLabel;
    let added = 0;
    let failed = 0;
    for (const entry of queue) {
      if (stopping) break;
      if (entry.state !== 'queued') continue;
      const name = labelFromFileName(entry.file.name);
      entry.label = sequence ? (labelsAfter(cursor, 1)?.[0] ?? name) : name;
      entry.state = 'uploading';
      entry.progress = 0;
      entry.message = null;
      if (sequence) inFlight = entry.label;
      const body = new FormData();
      body.append('file', entry.file);
      body.append('label', entry.label);
      current = uploadToAction(
        'upload',
        body,
        (fraction) => {
          entry.progress = fraction;
          if (fraction >= 1) entry.state = 'processing';
        },
        base,
      );
      const answer = await current.result;
      current = null;
      if (answer.type === 'success') {
        entry.state = 'done';
        const labels = (answer.data as { labels?: string[] } | undefined)?.labels;
        if (labels?.[0]) entry.label = labels[0];
        cursor = entry.label;
        added++;
        await onchanged();
        inFlight = null;
      } else if (stopping) {
        entry.state = 'queued';
        entry.label = null;
        entry.progress = 0;
      } else {
        entry.state = 'failed';
        entry.message = failureMessage(answer);
        failed++;
      }
      inFlight = null;
    }
    running = false;
    if (added > 0) toasts.success(failed > 0 ? t.upload.addedSome(added, failed) : t.upload.added(added));
    else if (failed > 1) toasts.error(t.upload.allFailed);
  }

  function stop() {
    stopping = true;
    // A file the server already has is let finish: aborting now would not stop its page being made.
    if (entries.some((e) => e.state === 'uploading')) current?.abort();
  }

  function status(entry: Entry): string {
    switch (entry.state) {
      case 'queued':
        return t.upload.queued;
      case 'uploading':
        return t.upload.uploading(Math.round(entry.progress * 100));
      case 'processing':
        return t.upload.processing;
      case 'done':
        return t.upload.done(entry.label ?? '');
      case 'failed':
        return entry.message ?? t.upload.failed;
    }
  }
</script>

<section aria-labelledby="add-images-heading" class="flex flex-col gap-3 rounded-md border border-line bg-surface p-4 font-sans">
  <div>
    <h2 id="add-images-heading" class="text-sm font-semibold text-ink">{t.upload.title}</h2>
    <p class="mt-0.5 text-xs text-ink-soft">{t.upload.hint(maxMb)}</p>
  </div>

  {#if result && !scripted}
    {#if result.ok && result.message}
      <Notice kind="success">{result.message}</Notice>
    {:else if !result.ok && result.error}
      <Notice kind="error">{result.error}</Notice>
    {/if}
    {#if result.failed && result.failed.length > 0}
      <ul class="text-xs text-danger">
        {#each result.failed as item (item.name)}
          <li>{t.upload.fileFailed(item.name, item.error)}</li>
        {/each}
      </ul>
    {/if}
  {/if}

  <form method="post" action={actionUrl('upload', base)} enctype="multipart/form-data" class="flex flex-col gap-3" onsubmit={start}>
    <div
      role="group"
      aria-label={t.upload.drop}
      class={[
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-dashed px-3 py-3 text-sm transition-colors',
        dragging ? 'border-accent bg-accent-soft' : 'border-line-strong bg-sunken/40',
      ]}
      ondragenter={dragover}
      ondragover={dragover}
      ondragleave={leave}
      ondrop={dropped}
    >
      <ImagePlus class="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
      {#if scripted}<span class="text-ink-soft">{t.upload.dropOr}</span>{/if}
      <input
        bind:this={input}
        type="file"
        name="file"
        multiple
        accept={ACCEPT_IMAGES}
        disabled={running}
        aria-label={t.upload.choose}
        class="min-w-0 max-w-full text-sm text-ink-soft file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface file:px-2.5 file:font-sans file:text-sm file:font-medium file:text-ink hover:file:bg-sunken"
        onchange={chosen}
      />
    </div>

    {#if canContinue && (!scripted || entries.length > 0)}
      <fieldset class="flex flex-col gap-1.5 text-sm" disabled={running}>
        <legend class="mb-1 text-xs font-medium text-ink">{t.upload.labelsFrom}</legend>
        <label class="flex items-start gap-2">
          <input type="radio" name="labelMode" value="sequence" bind:group={mode} class="mt-1" />
          <span>{t.upload.bySequence(continueExample?.join(', ') ?? '')}</span>
        </label>
        <label class="flex items-start gap-2">
          <input type="radio" name="labelMode" value="names" bind:group={mode} class="mt-1" />
          <span>{t.upload.byName}</span>
        </label>
      </fieldset>
    {/if}

    {#if entries.length > 0}
      <ul class="flex max-h-80 flex-col divide-y divide-line overflow-y-auto rounded-md border border-line" aria-label={t.upload.files}>
        {#each entries as entry (entry.key)}
          <li class="flex items-center gap-3 px-3 py-2 text-sm">
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-2">
                <span class="truncate text-ink" title={entry.file.name}>{entry.file.name}</span>
                <span class="shrink-0 text-xs text-ink-muted tabular-nums">{t.upload.size(entry.file.size)}</span>
              </div>
              {#if entry.state === 'uploading'}
                <div
                  class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line"
                  role="progressbar"
                  aria-label={entry.file.name}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(entry.progress * 100)}
                >
                  <div class="h-full rounded-full bg-accent transition-[width]" style:width="{Math.round(entry.progress * 100)}%"></div>
                </div>
              {/if}
              <p
                class={['mt-0.5 text-xs', entry.state === 'failed' ? 'text-danger' : entry.state === 'done' ? 'text-success' : 'text-ink-soft']}
                aria-live={entry.state === 'failed' ? 'assertive' : 'off'}
              >
                {#if entry.state === 'queued'}
                  <span class="font-medium text-ink">{labelOf(entry)}</span>
                  <span class="text-ink-muted"> · {status(entry)}</span>
                {:else}
                  {status(entry)}
                {/if}
              </p>
            </div>
            <div class="flex size-7 shrink-0 items-center justify-center">
              {#if entry.state === 'queued' && !running}
                <button
                  type="button"
                  class="inline-flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-sunken hover:text-ink"
                  aria-label={t.upload.remove(entry.file.name)}
                  title={t.upload.remove(entry.file.name)}
                  onclick={() => forget(entry)}
                >
                  <X class="size-4" aria-hidden="true" />
                </button>
              {:else if entry.state === 'uploading' || entry.state === 'processing'}
                <Spinner size="sm" class="text-ink-muted" />
              {:else if entry.state === 'done'}
                <Check class="size-4 text-success" aria-hidden="true" />
              {:else if entry.state === 'failed'}
                <CircleAlert class="size-4 text-danger" aria-hidden="true" />
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if !scripted || entries.length > 0}
      <div class="flex flex-wrap items-center gap-2">
        {#if running}
          <Button onclick={stop}>{t.upload.stop}</Button>
        {:else}
          <Button type="submit" variant="primary" disabled={scripted && pending.length === 0}>
            {t.upload.submit(scripted ? pending.length : 0)}
          </Button>
          {#if entries.length > 0}
            <Button variant="ghost" onclick={clear}>{t.upload.clear}</Button>
          {/if}
        {/if}
      </div>
    {/if}
  </form>
</section>
