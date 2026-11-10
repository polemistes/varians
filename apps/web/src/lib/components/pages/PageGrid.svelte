<script lang="ts">
  /**
   * The pages of a witness in order, as cards, and what can be done to one
   * of them: open it, rename it, move it, give it an image or take its image,
   * move its image to another page, remove it. Every change goes to a form
   * action of the witness's pages screen (`base` names it from elsewhere)
   * and is followed by `onchanged`, which loads the list again. Read only,
   * the grid only shows the pages and opens them.
   */
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { Button, Dialog, Field, Input, Select, toasts } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import { pageStrings as t } from '$lib/strings/pages';
  import { followingLabel } from './labels';
  import { actionUrl, failureMessage, megabytes, postAction, uploadToAction } from './client';
  import { isImageFile } from './files';
  import PageCard, { type CardBusy } from './PageCard.svelte';
  import PageImageDialog, { type ImageChoice, type ImageRequest } from './PageImageDialog.svelte';
  import PageViewerDialog from './PageViewerDialog.svelte';
  import RightsFields from './RightsFields.svelte';
  import type { ImageDefaults, PageView } from './types';

  interface Props {
    pages: PageView[];
    maxUploadBytes: number;
    /** The witness's rights statement and credit line for new images. */
    defaults?: ImageDefaults;
    /** Nothing may be changed. */
    readonly?: boolean;
    /** The id of the page shown in the text, marked on its card. */
    current?: string | null;
    /** The pages screen whose form actions receive the changes; the current page when empty. */
    base?: string;
    /** After a change: load the list again. */
    onchanged?: () => Promise<void> | void;
    /**
     * What a click on a card does. Absent, a page with an image opens in the
     * viewer and a page without one asks for an image.
     */
    onopen?: (page: PageView) => void;
    /** In the workbench: what each card says of the page's text in the transcript shown, in place of what refers to it. */
    textOf?: (page: PageView) => string;
  }

  let {
    pages,
    maxUploadBytes,
    defaults = { rights: null, attribution: null },
    readonly = false,
    current = null,
    base = '',
    onchanged = invalidateAll,
    onopen,
    textOf,
  }: Props = $props();

  const viewable = $derived(pages.filter((p) => p.source));
  let viewing = $state<string | null>(null);
  let busy = $state<Record<string, CardBusy>>({});

  function succeeded(data: unknown) {
    const message = (data as { message?: string } | undefined)?.message;
    if (message) toasts.success(message);
  }

  function view(page: PageView) {
    if (page.source) viewing = page.id;
  }

  function open(page: PageView) {
    if (onopen) onopen(page);
    else if (page.source) view(page);
    else if (!readonly) requestImage(page, null);
  }

  // Moving up and down

  async function move(page: PageView, to: number) {
    busy[page.id] = { kind: 'working' };
    const result = await postAction('move', { pageId: page.id, to: String(to) }, base);
    if (result.type === 'success') {
      await onchanged();
      succeeded(result.data);
    } else {
      toasts.error(failureMessage(result));
    }
    delete busy[page.id];
  }

  // Moving to a position

  let moving = $state<PageView | null>(null);
  let moveTo = $state('');
  let moveError = $state<string | null>(null);
  let moveSubmitting = $state(false);

  function openMove(page: PageView) {
    moving = page;
    moveTo = String(page.index);
    moveError = null;
  }

  // Images

  /** A page waiting for its image to be chosen, or its rights. */
  let imageRequest = $state<ImageRequest | null>(null);

  /**
   * Give a page an image. A file dropped on it goes straight up with the
   * witness's rights statement when the witness has one and no zones are at
   * stake; otherwise the dialog asks for the file, the rights or both.
   */
  function requestImage(page: PageView, file: File | null) {
    if (file && defaults.rights && !(page.imageKind && page.zones > 0)) {
      void sendImage(page, {
        file,
        rights: defaults.rights,
        attribution: defaults.attribution ?? '',
        imageSource: '',
      });
      return;
    }
    imageRequest = {
      id: page.id,
      label: page.label,
      imageKind: page.imageKind,
      zones: page.zones,
      rights: page.rights,
      attribution: page.attribution,
      file,
    };
  }

  async function sendImage(page: Pick<PageView, 'id'>, choice: ImageChoice) {
    const { file } = choice;
    if (!isImageFile(file)) {
      toasts.error(t.upload.notImage);
      return;
    }
    if (file.size > maxUploadBytes) {
      toasts.error(t.upload.tooLarge(megabytes(maxUploadBytes)));
      return;
    }
    const body = new FormData();
    body.append('pageId', page.id);
    body.append('file', file);
    body.append('rights', choice.rights);
    body.append('attribution', choice.attribution);
    body.append('imageSource', choice.imageSource);
    busy[page.id] = { kind: 'uploading', progress: 0 };
    const upload = uploadToAction(
      'replaceImage',
      body,
      (fraction) => {
        busy[page.id] =
          fraction >= 1 ? { kind: 'processing' } : { kind: 'uploading', progress: fraction };
      },
      base,
    );
    const result = await upload.result;
    if (result.type === 'success') {
      await onchanged();
      succeeded(result.data);
    } else {
      toasts.error(failureMessage(result));
    }
    delete busy[page.id];
  }

  // Moving an image to another page

  let movingImage = $state<PageView | null>(null);
  let imageTarget = $state('');
  let moveImageError = $state<string | null>(null);
  let moveImageSubmitting = $state(false);

  const imageTargets = $derived(movingImage ? pages.filter((p) => p.id !== movingImage!.id) : []);
  const targetPage = $derived(imageTargets.find((p) => p.id === imageTarget) ?? null);

  /** Proposes the next page, where an image most often belongs when it sits on the wrong one; else the page before. */
  function openMoveImage(page: PageView) {
    movingImage = page;
    const at = pages.findIndex((p) => p.id === page.id);
    imageTarget = (pages[at + 1] ?? pages[at - 1])?.id ?? '';
    moveImageError = null;
  }

  // Shifting the images from a page on

  let shifting = $state<PageView | null>(null);
  let shiftDirection = $state<'later' | 'earlier'>('later');
  let shiftError = $state<string | null>(null);
  let shiftSubmitting = $state(false);

  const shiftInfo = $derived.by(() => {
    if (!shifting) return null;
    const at = pages.findIndex((p) => p.id === shifting!.id);
    const tail = pages.slice(at);
    const before = at > 0 ? pages[at - 1]! : null;
    const last = pages[pages.length - 1]!;
    return {
      before,
      any: tail.some((p) => p.imageKind),
      adds: last.imageKind
        ? { last: last.label, next: followingLabel(last.label) ?? String(pages.length + 1) }
        : null,
      earlierProblem: !before
        ? t.shiftImages.firstPage
        : before.imageKind
          ? t.shiftImages.occupied(before.label)
          : null,
    };
  });

  function openShift(page: PageView) {
    shifting = page;
    shiftError = null;
    const at = pages.findIndex((p) => p.id === page.id);
    const before = at > 0 ? pages[at - 1] : null;
    // A run that began a page too late leaves the page before it bare: then earlier is what is wanted.
    shiftDirection = before && !before.imageKind && page.imageKind ? 'earlier' : 'later';
  }

  // The rights of a page's image

  let rightsOf = $state<PageView | null>(null);
  let rightsDraft = $state('');
  let attributionDraft = $state('');
  let sourceDraft = $state('');
  let rightsErrors = $state<Record<string, string[] | undefined>>({});
  let rightsSubmitting = $state(false);

  function openRights(page: PageView) {
    rightsOf = page;
    rightsDraft = page.rights ?? '';
    attributionDraft = page.attribution ?? '';
    sourceDraft = page.imageSource ?? '';
    rightsErrors = {};
  }

  // Taking an image away

  let unimaging = $state<PageView | null>(null);
  let unimageSubmitting = $state(false);

  // Removing

  let removing = $state<PageView | null>(null);
  let removeSubmitting = $state(false);

  function openRemove(page: PageView) {
    removing = page;
  }
</script>

<ol class="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4" aria-label={t.gridLabel}>
  {#each pages as page (page.id)}
    <li>
      <PageCard
        {page}
        count={pages.length}
        text={textOf ? textOf(page) : null}
        busy={busy[page.id] ?? null}
        current={page.id === current}
        {readonly}
        {base}
        {onchanged}
        onopen={open}
        onview={onopen ? view : undefined}
        onmove={move}
        onmoveto={openMove}
        onreplaceimage={(p) => requestImage(p, null)}
        onmoveimage={openMoveImage}
        onshiftimages={openShift}
        onrights={openRights}
        onremoveimage={(p) => (unimaging = p)}
        onremove={openRemove}
        ondropimage={requestImage}
      />
    </li>
  {/each}
</ol>

<PageViewerDialog pages={viewable} bind:current={viewing} />

{#if !readonly}
  <PageImageDialog
    bind:request={imageRequest}
    {defaults}
    maxBytes={maxUploadBytes}
    onconfirm={(request, choice) => void sendImage(request, choice)}
  />

  <Dialog
    bind:open={
      () => rightsOf !== null,
      (open) => {
        if (!open) rightsOf = null;
      }
    }
    title={rightsOf ? t.rights.title(rightsOf.label) : ''}
    size="md"
  >
    {#if rightsOf}
      {@const page = rightsOf}
      <form
        id="rights-form"
        method="post"
        action={actionUrl('rights', base)}
        novalidate
        use:enhance={({ cancel }) => {
          if (!rightsDraft) {
            rightsErrors = { rights: [t.rights.required] };
            cancel();
            return;
          }
          rightsSubmitting = true;
          return async ({ result }) => {
            rightsSubmitting = false;
            if (result.type === 'success') {
              rightsOf = null;
              await onchanged();
              succeeded(result.data);
            } else if (
              result.type === 'failure' &&
              (result.data as { errors?: Record<string, string[]> } | undefined)?.errors
            ) {
              rightsErrors = (result.data as { errors: Record<string, string[]> }).errors;
            } else {
              rightsOf = null;
              toasts.error(failureMessage(result));
            }
          };
        }}
      >
        <input type="hidden" name="pageId" value={page.id} />
        <RightsFields
          bind:rights={rightsDraft}
          bind:attribution={attributionDraft}
          bind:source={sourceDraft}
          required
          errors={rightsErrors}
        />
      </form>
    {/if}
    {#snippet footer()}
      <Button onclick={() => (rightsOf = null)}>{s.common.cancel}</Button>
      <Button type="submit" form="rights-form" variant="primary" loading={rightsSubmitting}
        >{t.rights.submit}</Button
      >
    {/snippet}
  </Dialog>

  <Dialog
    bind:open={
      () => moving !== null,
      (open) => {
        if (!open) moving = null;
      }
    }
    title={moving ? t.move.title(moving.label) : ''}
    description={t.move.description(pages.length)}
    size="sm"
  >
    {#if moving}
      {@const page = moving}
      <form
        id="move-form"
        method="post"
        action={actionUrl('move', base)}
        novalidate
        use:enhance={({ cancel }) => {
          const to = Number(moveTo);
          if (!Number.isInteger(to) || to < 1 || to > pages.length) {
            moveError = t.move.invalid(pages.length);
            cancel();
            return;
          }
          moveSubmitting = true;
          return async ({ result }) => {
            moveSubmitting = false;
            if (result.type === 'success') {
              moving = null;
              await onchanged();
              succeeded(result.data);
            } else {
              moveError = failureMessage(result);
            }
          };
        }}
      >
        <input type="hidden" name="pageId" value={page.id} />
        <Field label={t.move.position} error={moveError}>
          {#snippet children(control)}
            <Input
              {...control}
              name="to"
              type="number"
              min="1"
              max={pages.length}
              step="1"
              required
              bind:value={moveTo}
              class="w-32"
            />
          {/snippet}
        </Field>
      </form>
    {/if}
    {#snippet footer()}
      <Button onclick={() => (moving = null)}>{s.common.cancel}</Button>
      <Button type="submit" form="move-form" variant="primary" loading={moveSubmitting}
        >{t.move.submit}</Button
      >
    {/snippet}
  </Dialog>

  <Dialog
    bind:open={
      () => movingImage !== null,
      (open) => {
        if (!open) movingImage = null;
      }
    }
    title={movingImage ? t.moveImage.title(movingImage.label) : ''}
    description={t.moveImage.description}
    size="sm"
  >
    {#if movingImage}
      {@const page = movingImage}
      <form
        id="move-image-form"
        method="post"
        action={actionUrl('moveImage', base)}
        novalidate
        class="flex flex-col gap-3"
        use:enhance={({ cancel }) => {
          if (!targetPage) {
            moveImageError = t.moveImage.choose;
            cancel();
            return;
          }
          moveImageSubmitting = true;
          return async ({ result }) => {
            moveImageSubmitting = false;
            if (result.type === 'success') {
              movingImage = null;
              await onchanged();
              succeeded(result.data);
            } else {
              moveImageError = failureMessage(result);
            }
          };
        }}
      >
        <input type="hidden" name="pageId" value={page.id} />
        <Field label={t.moveImage.target} error={moveImageError}>
          {#snippet children(control)}
            <Select
              {...control}
              name="toPageId"
              bind:value={imageTarget}
              options={imageTargets.map((p) => ({
                value: p.id,
                label: p.imageKind ? t.moveImage.withImage(p.label) : p.label,
              }))}
            />
          {/snippet}
        </Field>
        {#if targetPage?.imageKind}
          <p class="text-ink-soft">{t.moveImage.swaps(targetPage.label)}</p>
        {/if}
        {#if page.zones > 0}
          <p class="text-ink-soft">{t.moveImage.zones(page.zones, page.label)}</p>
        {/if}
      </form>
    {/if}
    {#snippet footer()}
      <Button onclick={() => (movingImage = null)}>{s.common.cancel}</Button>
      <Button type="submit" form="move-image-form" variant="primary" loading={moveImageSubmitting}
        >{t.moveImage.submit}</Button
      >
    {/snippet}
  </Dialog>

  <Dialog
    bind:open={
      () => shifting !== null,
      (open) => {
        if (!open) shifting = null;
      }
    }
    title={shifting ? t.shiftImages.title(shifting.label) : ''}
    description={t.shiftImages.description}
    size="md"
  >
    {#if shifting && shiftInfo}
      {@const page = shifting}
      {@const info = shiftInfo}
      <form
        id="shift-form"
        method="post"
        action={actionUrl('shiftImages', base)}
        novalidate
        class="flex flex-col gap-3"
        use:enhance={({ cancel }) => {
          const problem = !info.any
            ? t.shiftImages.nothing
            : shiftDirection === 'earlier'
              ? info.earlierProblem
              : null;
          if (problem) {
            shiftError = problem;
            cancel();
            return;
          }
          shiftSubmitting = true;
          return async ({ result }) => {
            shiftSubmitting = false;
            if (result.type === 'success') {
              shifting = null;
              await onchanged();
              succeeded(result.data);
            } else {
              shiftError = failureMessage(result);
            }
          };
        }}
      >
        <input type="hidden" name="pageId" value={page.id} />
        <fieldset class="flex flex-col gap-2.5">
          <label class="flex items-start gap-2">
            <input
              type="radio"
              name="direction"
              value="later"
              bind:group={shiftDirection}
              class="mt-1"
            />
            <span>
              <span class="font-medium text-ink">{t.shiftImages.later}</span>
              <span class="block text-ink-soft">{t.shiftImages.laterHint(page.label)}</span>
              {#if info.adds}<span class="block text-ink-soft"
                  >{t.shiftImages.laterAdds(info.adds.last, info.adds.next)}</span
                >{/if}
            </span>
          </label>
          <label class={['flex items-start gap-2', info.earlierProblem && 'opacity-60']}>
            <input
              type="radio"
              name="direction"
              value="earlier"
              bind:group={shiftDirection}
              disabled={!!info.earlierProblem}
              class="mt-1"
            />
            <span>
              <span class="font-medium text-ink">{t.shiftImages.earlier}</span>
              <span class="block text-ink-soft"
                >{info.earlierProblem ??
                  t.shiftImages.earlierHint(info.before?.label ?? '', page.label)}</span
              >
            </span>
          </label>
        </fieldset>
        <p class="text-ink-soft">{t.shiftImages.zones}</p>
        {#if shiftError || !info.any}
          <p class="text-danger" role="alert">{shiftError ?? t.shiftImages.nothing}</p>
        {/if}
      </form>
    {/if}
    {#snippet footer()}
      <Button onclick={() => (shifting = null)}>{s.common.cancel}</Button>
      <Button
        type="submit"
        form="shift-form"
        variant="primary"
        loading={shiftSubmitting}
        disabled={!shiftInfo?.any}>{t.shiftImages.submit}</Button
      >
    {/snippet}
  </Dialog>

  <Dialog
    bind:open={
      () => unimaging !== null,
      (open) => {
        if (!open) unimaging = null;
      }
    }
    title={unimaging ? t.removeImage.title(unimaging.label) : ''}
    description={t.removeImage.description}
    size="sm"
  >
    {#if unimaging}
      {@const page = unimaging}
      <form
        id="remove-image-form"
        method="post"
        action={actionUrl('removeImage', base)}
        use:enhance={() => {
          unimageSubmitting = true;
          return async ({ result }) => {
            unimageSubmitting = false;
            unimaging = null;
            if (result.type === 'success') {
              await onchanged();
              succeeded(result.data);
            } else {
              toasts.error(failureMessage(result));
            }
          };
        }}
      >
        <input type="hidden" name="pageId" value={page.id} />
        {#if page.zones > 0}
          <p class="text-ink-soft">{t.removeImage.zones(page.zones)}</p>
        {/if}
      </form>
    {/if}
    {#snippet footer()}
      <Button onclick={() => (unimaging = null)}>{s.common.cancel}</Button>
      <Button type="submit" form="remove-image-form" variant="danger" loading={unimageSubmitting}
        >{t.removeImage.submit}</Button
      >
    {/snippet}
  </Dialog>

  <Dialog
    bind:open={
      () => removing !== null,
      (open) => {
        if (!open) removing = null;
      }
    }
    title={removing ? t.remove.title(removing.label) : ''}
    description={removing
      ? t.remove.description(
          removing.label,
          removing.words,
          removing.transcriptions,
          removing.zones,
          removing.imageKind !== null,
        )
      : undefined}
    size="md"
  >
    {#if removing}
      {@const page = removing}
      <form
        id="remove-form"
        method="post"
        action={actionUrl('remove', base)}
        use:enhance={() => {
          removeSubmitting = true;
          return async ({ result }) => {
            removeSubmitting = false;
            if (result.type === 'success') {
              removing = null;
              await onchanged();
              succeeded(result.data);
            } else {
              removing = null;
              toasts.error(failureMessage(result));
            }
          };
        }}
      >
        <input type="hidden" name="pageId" value={page.id} />
      </form>
    {/if}
    {#snippet footer()}
      <Button onclick={() => (removing = null)}>{s.common.cancel}</Button>
      <Button type="submit" form="remove-form" variant="danger" loading={removeSubmitting}>
        {t.remove.submit}
      </Button>
    {/snippet}
  </Dialog>
{/if}
