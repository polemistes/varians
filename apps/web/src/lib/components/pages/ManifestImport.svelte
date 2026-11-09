<script lang="ts">
  /**
   * Pages from a IIIF manifest: the URL (the witness's own when it has one),
   * a preview of what the manifest holds, a choice of what happens to the
   * pages already there, and the import.
   */
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import ImageOff from '@lucide/svelte/icons/image-off';
  import { Button, Dialog, Field, Input, Notice, toasts, type ButtonSize } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import { pageStrings as t } from '$lib/strings/pages';
  import { actionUrl, failureMessage } from './client';
  import type { ImportMode, ManifestPreviewView } from './types';

  interface Props {
    /** The manifest stored on the witness, if any. */
    manifestUrl: string | null;
    /** Whether the witness has pages, so that there is something to keep or replace. */
    hasPages: boolean;
    /** The pages screen whose form actions do the work; the current page when empty. */
    base?: string;
    /** After an import: the list is loaded again. */
    onchanged?: () => Promise<void> | void;
    size?: ButtonSize;
  }

  let { manifestUrl, hasPages, base = '', onchanged = invalidateAll, size = 'md' }: Props = $props();

  const WARNINGS_SHOWN = 6;

  let open = $state(false);
  let url = $state(untrack(() => manifestUrl ?? ''));
  let preview = $state<ManifestPreviewView | null>(null);
  let urlError = $state<string | null>(null);
  let importError = $state<string | null>(null);
  let mode = $state<ImportMode>('new');
  let pending = $state<'preview' | 'import' | null>(null);
  let failedThumbs = $state<Record<number, boolean>>({});

  const stale = $derived(preview !== null && preview.url !== url.trim());
  const importable = $derived(preview !== null && !stale && preview.total > 0);

  $effect(() => {
    // Opening the dialog brings in the witness's manifest when nothing has been typed.
    if (open && url === '' && manifestUrl) untrack(() => (url = manifestUrl ?? ''));
  });
</script>

<Dialog bind:open title={t.manifest.title} description={t.manifest.description} size="lg">
  {#snippet trigger({ props })}
    <Button {...props} variant="secondary" {size}>{t.manifest.open}</Button>
  {/snippet}

  <form
    id="manifest-form"
    method="post"
    action={actionUrl('preview', base)}
    novalidate
    class="flex flex-col gap-4"
    use:enhance={({ action }) => {
      const which = action.search.includes('import') ? 'import' : 'preview';
      pending = which;
      urlError = null;
      importError = null;
      return async ({ result }) => {
        pending = null;
        if (result.type === 'success') {
          const data = result.data as { preview?: ManifestPreviewView; message?: string } | undefined;
          if (which === 'preview') {
            preview = data?.preview ?? null;
            failedThumbs = {};
          } else {
            open = false;
            preview = null;
            await onchanged();
            if (data?.message) toasts.success(data.message);
          }
        } else if (result.type === 'failure') {
          if (which === 'preview') {
            urlError = failureMessage(result);
            preview = null;
          } else importError = failureMessage(result);
        } else {
          importError = failureMessage(result);
        }
      };
    }}
  >
    <Field label={t.manifest.url} hint={t.manifest.urlHint} error={urlError}>
      {#snippet children(control)}
        <Input
          {...control}
          name="manifestUrl"
          type="url"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          placeholder="https://"
          required
          bind:value={url}
        />
      {/snippet}
    </Field>

    {#if pending === 'preview'}
      <p class="text-sm text-ink-soft" role="status">{t.manifest.previewing}</p>
    {:else if preview}
      <div class="flex flex-col gap-3" aria-live="polite">
        <div>
          <p class="font-medium text-ink">{preview.label}</p>
          <p class="text-ink-soft">
            {t.manifest.summary(preview.total, preview.withImage)}
            {#if preview.present > 0}{t.manifest.present(preview.present)}{/if}
            {#if preview.attachable > 0}{t.manifest.attachable(preview.attachable)}{/if}
          </p>
        </div>

        {#if preview.canvases.length > 0}
          <div>
            <p class="mb-1.5 text-xs text-ink-muted">{t.manifest.firstCanvases(preview.canvases.length, preview.total)}</p>
            <ul class="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {#each preview.canvases as canvas, i (i)}
                <li class="flex min-w-0 flex-col gap-1">
                  <div class="flex aspect-[3/4] items-center justify-center overflow-hidden rounded border border-line bg-sunken">
                    {#if canvas.thumbnail && !failedThumbs[i]}
                      <img
                        src={canvas.thumbnail}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        class="max-h-full max-w-full object-contain"
                        onerror={() => (failedThumbs[i] = true)}
                      />
                    {:else}
                      <ImageOff class="size-4 text-ink-muted" aria-label={t.manifest.noImage} />
                    {/if}
                  </div>
                  <span class="truncate text-center text-xs text-ink-soft" title={canvas.label}>{canvas.label}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if preview.warnings.length > 0}
          <Notice kind="warning" title={t.manifest.warnings}>
            <ul class="list-disc pl-4">
              {#each preview.warnings.slice(0, WARNINGS_SHOWN) as warning, i (i)}
                <li>{warning}</li>
              {/each}
              {#if preview.warnings.length > WARNINGS_SHOWN}
                <li>{t.manifest.moreWarnings(preview.warnings.length - WARNINGS_SHOWN)}</li>
              {/if}
            </ul>
          </Notice>
        {/if}

        {#if hasPages}
          <fieldset class="flex flex-col gap-2">
            <legend class="mb-1 text-sm font-medium text-ink">{t.manifest.mode}</legend>
            <label class="flex items-start gap-2.5">
              <input type="radio" name="mode" value="new" bind:group={mode} class="mt-1" />
              <span class="flex flex-col">
                <span>{t.manifest.modeNew}</span>
                <span class="text-xs text-ink-soft">{t.manifest.modeNewHint}</span>
              </span>
            </label>
            <label class="flex items-start gap-2.5">
              <input type="radio" name="mode" value="replace" bind:group={mode} class="mt-1" />
              <span class="flex flex-col">
                <span>{t.manifest.modeReplace}</span>
                <span class="text-xs text-ink-soft">{t.manifest.modeReplaceHint}</span>
              </span>
            </label>
          </fieldset>
        {:else}
          <input type="hidden" name="mode" value="new" />
        {/if}
      </div>
    {/if}

    {#if stale}
      <p class="text-xs text-ink-soft">{t.manifest.previewAgain}</p>
    {/if}
    {#if importError}
      <Notice kind="error">{importError}</Notice>
    {/if}
  </form>

  {#snippet footer()}
    <Button onclick={() => (open = false)}>{s.common.cancel}</Button>
    <Button
      type="submit"
      form="manifest-form"
      formaction={actionUrl('preview', base)}
      variant={importable ? 'secondary' : 'primary'}
      loading={pending === 'preview'}
      disabled={pending !== null}
    >
      {t.manifest.preview}
    </Button>
    {#if importable && preview}
      <Button
        type="submit"
        form="manifest-form"
        formaction={actionUrl('import', base)}
        variant={mode === 'replace' ? 'danger' : 'primary'}
        loading={pending === 'import'}
        disabled={pending !== null}
      >
        {t.manifest.import(preview.total)}
      </Button>
    {/if}
  {/snippet}
</Dialog>
