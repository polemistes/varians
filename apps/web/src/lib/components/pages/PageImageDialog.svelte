<script lang="ts" module>
  /** What is sent with an image for one page. */
  export interface ImageChoice {
    file: File;
    rights: string;
    attribution: string;
    imageSource: string;
  }

  /** The page an image is asked for, and the file already dropped on it, if any. */
  export interface ImageRequest {
    id: string;
    label: string;
    imageKind: string | null;
    zones: number;
    rights: string | null;
    attribution: string | null;
    file: File | null;
  }
</script>

<script lang="ts">
  /**
   * An image for one page, with its rights: the file (unless one
   * was dropped), the rights statement, preselected from the witness's
   * default or else the page's own, the credit line and the source. When the
   * page's present image carries zones, says what becomes of them. The
   * caller sends what is chosen.
   */
  import { Button, Dialog, Field, Notice } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import { pageStrings as t } from '$lib/strings/pages';
  import { megabytes } from './client';
  import { ACCEPT_IMAGES, isImageFile } from './files';
  import RightsFields from './RightsFields.svelte';
  import type { ImageDefaults } from './types';

  interface Props {
    /** The request; null while closed. */
    request: ImageRequest | null;
    defaults: ImageDefaults;
    maxBytes: number;
    onconfirm: (request: ImageRequest, choice: ImageChoice) => void;
  }

  let { request = $bindable(), defaults, maxBytes, onconfirm }: Props = $props();

  let file = $state<File | null>(null);
  let rights = $state('');
  let attribution = $state('');
  let source = $state('');
  let errors = $state<Record<string, string | null>>({});
  let shownFor: ImageRequest | null = null;

  $effect.pre(() => {
    // Each request starts from the witness's defaults, or the page's own rights where the witness has none.
    if (request === shownFor) return;
    shownFor = request;
    if (!request) return;
    file = request.file;
    rights = defaults.rights ?? request.rights ?? '';
    attribution = (defaults.rights ? defaults.attribution : request.attribution) ?? '';
    source = '';
    errors = {};
  });

  function chosen(event: Event) {
    file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!request) return;
    const found: Record<string, string | null> = {};
    if (!file) found.file = t.upload.fileRequired;
    else if (!isImageFile(file)) found.file = t.upload.notImage;
    else if (file.size > maxBytes) found.file = t.upload.tooLarge(megabytes(maxBytes));
    if (!rights) found.rights = t.rights.required;
    errors = found;
    if (Object.keys(found).length > 0 || !file) return;
    const done = request;
    request = null;
    onconfirm(done, { file, rights, attribution, imageSource: source });
  }
</script>

<Dialog
  bind:open={
    () => request !== null,
    (open) => {
      if (!open) request = null;
    }
  }
  title={request ? (request.imageKind ? t.image.replaceTitle(request.label) : t.image.addTitle(request.label)) : ''}
  size="md"
>
  {#if request}
    <form id="page-image-form" class="flex flex-col gap-4" novalidate onsubmit={submit}>
      {#if request.imageKind && request.zones > 0}
        <Notice kind="warning">{t.replaceImage.zones(request.zones)}</Notice>
      {/if}
      {#if request.file}
        <p class="text-sm text-ink"><span class="font-medium">{t.image.file}:</span> {request.file.name}</p>
      {:else}
        <Field label={t.image.file} required error={errors.file}>
          {#snippet children(control)}
            <input
              {...control}
              type="file"
              accept={ACCEPT_IMAGES}
              class="min-w-0 max-w-full text-sm text-ink-soft file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface file:px-2.5 file:font-sans file:text-sm file:font-medium file:text-ink hover:file:bg-sunken"
              onchange={chosen}
            />
          {/snippet}
        </Field>
      {/if}
      <RightsFields bind:rights bind:attribution bind:source required {errors} />
    </form>
  {/if}
  {#snippet footer()}
    <Button onclick={() => (request = null)}>{s.common.cancel}</Button>
    <Button type="submit" form="page-image-form" variant="primary">{t.image.submit}</Button>
  {/snippet}
</Dialog>
