<script lang="ts" module>
  /** What a card shows while something happens to its page. */
  export type CardBusy =
    | { kind: 'uploading'; progress: number }
    | { kind: 'processing' }
    | { kind: 'working' };
</script>

<script lang="ts">
  /**
   * One page as a card: its image (or the place for one), its label and its
   * position, and the menu of what can be done to it. A click on the frame
   * opens the page: the parent says what that means (view the image, or go
   * to the page in the text). An image file dropped on the card becomes the
   * page's image. Read only, the card just shows the page.
   */
  import { tick } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';
  import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
  import ChevronsDown from '@lucide/svelte/icons/chevrons-down';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Eye from '@lucide/svelte/icons/eye';
  import ImageOff from '@lucide/svelte/icons/image-off';
  import ImageUp from '@lucide/svelte/icons/image-up';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Scale from '@lucide/svelte/icons/scale';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';
  import { Menu, MenuItem, MenuSeparator, Spinner, toasts } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import { pageStrings as t } from '$lib/strings/pages';
  import { actionUrl, failureMessage } from './client';
  import { rightsLabel } from './rights';
  import type { PageView } from './types';

  interface Props {
    page: PageView;
    /** How many pages the witness has, to know the last. */
    count: number;
    /** What the card says of the page's text in the transcript shown, in place of what refers to it. */
    text?: string | null;
    busy?: CardBusy | null;
    /** The page shown in the text: marked. */
    current?: boolean;
    /** Nothing may be changed: no menu, no renaming, no dropping of images. */
    readonly?: boolean;
    /** The pages screen whose form actions receive the changes; the current page when empty. */
    base?: string;
    /** After a change: the list is loaded again. */
    onchanged?: () => Promise<void> | void;
    /** The frame was clicked: show the page. */
    onopen: (page: PageView) => void;
    /** What the menu's View does when the parent distinguishes it from opening; absent, View is not offered. */
    onview?: (page: PageView) => void;
    /** Move to a position from 1. */
    onmove: (page: PageView, to: number) => void;
    onmoveto: (page: PageView) => void;
    onreplaceimage: (page: PageView) => void;
    onmoveimage: (page: PageView) => void;
    onshiftimages: (page: PageView) => void;
    /** The rights of the page's image. */
    onrights: (page: PageView) => void;
    onremoveimage: (page: PageView) => void;
    onremove: (page: PageView) => void;
    /** An image file was dropped on the card. */
    ondropimage: (page: PageView, file: File) => void;
  }

  let {
    page,
    count,
    text = null,
    busy = null,
    current = false,
    readonly = false,
    base = '',
    onchanged = invalidateAll,
    onopen,
    onview,
    onmove,
    onmoveto,
    onreplaceimage,
    onmoveimage,
    onshiftimages,
    onrights,
    onremoveimage,
    onremove,
    ondropimage,
  }: Props = $props();

  let editing = $state(false);
  let saving = $state(false);
  let draft = $state('');
  let renameError = $state<string | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  let form = $state<HTMLFormElement | null>(null);
  let labelButton = $state<HTMLButtonElement | null>(null);
  let thumbFailed = $state(false);
  let dragging = $state(false);
  /** Set by Escape, so that the blur of the closing input does not save. */
  let cancelled = false;

  const meta = $derived.by(() => {
    const parts: string[] = [];
    if (page.width && page.height) parts.push(t.card.size(page.width, page.height));
    if (page.imageKind === 'iiif') parts.push(t.card.iiif);
    return parts.join(' · ');
  });
  /** The image's rights statement, or that it has none. */
  const rights = $derived(page.imageKind ? (rightsLabel(page.rights) ?? t.rights.missing) : null);
  const references = $derived.by(() => {
    const parts: string[] = [];
    if (page.zones > 0) parts.push(t.card.zones(page.zones));
    if (page.transcriptions > 0) parts.push(t.card.breaks(page.transcriptions));
    return parts.join(', ');
  });
  const percent = $derived(busy?.kind === 'uploading' ? Math.round(busy.progress * 100) : 0);
  const openLabel = $derived(onview ? t.card.open(page.label) : t.card.view(page.label));

  $effect(() => {
    // A new thumbnail (a replaced image) gets a fresh chance to load.
    void page.thumbnail;
    thumbFailed = false;
  });

  async function startEditing() {
    if (readonly) return;
    draft = page.label;
    renameError = null;
    cancelled = false;
    editing = true;
    await tick();
    input?.focus();
    input?.select();
  }

  /** Closes the field; `refocus` puts the focus back on the label, for a keyboard that was in the field. */
  async function stopEditing(refocus: boolean) {
    cancelled = true;
    editing = false;
    renameError = null;
    if (refocus) {
      await tick();
      labelButton?.focus();
    }
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      stopEditing(true);
    }
  }

  function blur() {
    if (cancelled || saving || !editing) return;
    // Leaving the field keeps the change, as Enter does; focus has moved on, so it stays where it went.
    if (draft.trim() === page.label) stopEditing(false);
    else form?.requestSubmit();
  }

  // An image dropped on the card

  function dragover(event: DragEvent) {
    if (readonly || busy || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    dragging = true;
  }

  function dragleave(event: DragEvent) {
    const next = event.relatedTarget as Node | null;
    if (!next || !(event.currentTarget as Node).contains(next)) dragging = false;
  }

  function drop(event: DragEvent) {
    if (readonly || busy) return;
    event.preventDefault();
    dragging = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) ondropimage(page, file);
  }
</script>

<article
  class={[
    'group relative flex h-full flex-col overflow-hidden rounded-md border bg-surface font-sans transition-colors',
    dragging ? 'border-accent ring-2 ring-accent/30' : busy ? 'border-accent/40' : current ? 'border-accent' : 'border-line hover:border-line-strong',
    current && !dragging && 'ring-2 ring-accent/30',
  ]}
  aria-label={page.label}
  aria-current={current ? 'true' : undefined}
  data-page-id={page.id}
  ondragenter={dragover}
  ondragover={dragover}
  ondragleave={dragleave}
  ondrop={drop}
>
  <div class="relative aspect-[3/4] bg-sunken">
    {#if page.thumbnail && !thumbFailed}
      <button
        type="button"
        class="absolute inset-0 flex items-center justify-center p-2"
        onclick={() => onopen(page)}
        aria-label={openLabel}
        title={openLabel}
      >
        <img
          src={page.thumbnail}
          alt=""
          loading="lazy"
          decoding="async"
          class="max-h-full max-w-full object-contain shadow-sm"
          onerror={() => (thumbFailed = true)}
        />
      </button>
    {:else}
      <button
        type="button"
        class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-ink-muted hover:text-ink-soft"
        onclick={() => onopen(page)}
        aria-label={openLabel}
        title={openLabel}
      >
        <ImageOff class="size-5" aria-hidden="true" />
        <span class="text-xs">{t.card.noImage}</span>
      </button>
      {#if !readonly}
        <button
          type="button"
          class="absolute inset-x-2 bottom-2 inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-2 text-xs font-medium text-ink shadow-sm transition-colors hover:border-line-strong hover:bg-sunken disabled:pointer-events-none disabled:opacity-50"
          onclick={() => onreplaceimage(page)}
          disabled={!!busy}
        >
          <ImageUp class="size-3.5" aria-hidden="true" />
          {t.card.addImage}
        </button>
      {/if}
    {/if}
    <span
      class="pointer-events-none absolute top-1.5 left-1.5 rounded bg-surface/85 px-1.5 py-0.5 text-[11px] leading-none font-medium text-ink-soft tabular-nums"
      title={t.card.position(page.index)}
    >
      {page.index}
    </span>
    {#if dragging}
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center bg-accent-soft/90 px-3 text-center text-xs font-medium text-accent">
        {t.card.dropHere}
      </div>
    {:else if busy}
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface/80 px-4 text-xs text-ink-soft" role="status">
        {#if busy.kind === 'uploading'}
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
            <div class="h-full rounded-full bg-accent transition-[width]" style:width="{percent}%"></div>
          </div>
          <span>{t.card.uploading(percent)}</span>
        {:else}
          <Spinner size="sm" />
          <span>{busy.kind === 'processing' ? t.card.processing : t.card.working}</span>
        {/if}
      </div>
    {/if}
  </div>

  <div class="flex items-start gap-1 border-t border-line px-2.5 pt-2 pb-2.5">
    <div class="min-w-0 flex-1">
      {#if editing}
        <form
          method="post"
          action={actionUrl('rename', base)}
          bind:this={form}
          use:enhance={() => {
            // Enter in the field, rather than leaving it, is answered by focus back on the label.
            const fromField = document.activeElement === input;
            saving = true;
            return async ({ result }) => {
              saving = false;
              if (result.type === 'success') {
                const message = (result.data as { message?: string } | undefined)?.message;
                if (message) toasts.success(message);
                await onchanged();
                await stopEditing(fromField);
              } else {
                renameError = failureMessage(result);
                input?.focus();
              }
            };
          }}
        >
          <input type="hidden" name="pageId" value={page.id} />
          <label class="sr-only" for="label-{page.id}">{t.card.renameField}</label>
          <div class="flex items-center gap-1">
            <input
              bind:this={input}
              bind:value={draft}
              id="label-{page.id}"
              name="label"
              autocomplete="off"
              spellcheck="false"
              title={t.rename.cancel}
              aria-invalid={renameError ? 'true' : undefined}
              aria-describedby={renameError ? `label-error-${page.id}` : undefined}
              class="h-7 w-full min-w-0 rounded border border-accent bg-surface px-1.5 text-sm font-medium text-ink focus:ring-2 focus:ring-accent/20 focus:outline-none aria-invalid:border-danger"
              onkeydown={keydown}
              onblur={blur}
              disabled={saving}
            />
            {#if saving}
              <Spinner size="sm" class="shrink-0 text-ink-muted" />
            {:else}
              <button
                type="button"
                class="inline-flex size-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-sunken hover:text-ink"
                aria-label={s.common.cancel}
                onmousedown={(event) => event.preventDefault()}
                onclick={() => stopEditing(true)}
              >
                <X class="size-3.5" aria-hidden="true" />
              </button>
            {/if}
          </div>
          {#if renameError}
            <p id="label-error-{page.id}" class="mt-1 text-xs text-danger" role="alert">{renameError}</p>
          {/if}
        </form>
      {:else if readonly}
        <p class="truncate text-sm font-medium text-ink" title={page.label}>{page.label}</p>
      {:else}
        <button
          bind:this={labelButton}
          type="button"
          class="-mx-1 flex max-w-full items-center gap-1 rounded px-1 text-left text-sm font-medium text-ink hover:bg-sunken"
          onclick={startEditing}
          title={t.card.rename(page.label)}
          aria-label={t.card.rename(page.label)}
        >
          <span class="truncate">{page.label}</span>
          <Pencil class="size-3 shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" aria-hidden="true" />
        </button>
      {/if}
      {#if meta}
        <p class="mt-0.5 truncate text-xs text-ink-muted tabular-nums">{meta}</p>
      {/if}
      {#if rights}
        <p
          class={['mt-0.5 truncate text-xs', page.rights ? 'text-ink-muted' : 'text-warning']}
          title={[rights, page.attribution].filter(Boolean).join(' · ')}
        >
          {rights}
        </p>
      {/if}
      {#if text}
        <p class="mt-0.5 truncate text-xs text-ink-muted">{text}</p>
      {:else if references}
        <p class="mt-0.5 truncate text-xs text-ink-muted" title={t.card.referencedTitle}>{references}</p>
      {/if}
    </div>

    {#if !readonly}
      <Menu label={t.card.menu(page.label)} triggerSize="sm" triggerClass="w-8 px-0! text-ink-soft" align="end">
        {#snippet trigger()}
          <Ellipsis class="size-4" strokeWidth={2.25} aria-hidden="true" />
        {/snippet}
        {#if onview && page.source}
          <MenuItem onSelect={() => onview(page)}>
            {#snippet icon()}<Eye />{/snippet}
            {t.menu.view}
          </MenuItem>
        {/if}
        <MenuItem disabled={!!busy} onSelect={() => void startEditing()}>
          {#snippet icon()}<Pencil />{/snippet}
          {t.menu.rename}
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={page.index <= 1 || !!busy} onSelect={() => onmove(page, page.index - 1)}>
          {#snippet icon()}<ArrowUp />{/snippet}
          {t.menu.moveUp}
        </MenuItem>
        <MenuItem disabled={page.index >= count || !!busy} onSelect={() => onmove(page, page.index + 1)}>
          {#snippet icon()}<ArrowDown />{/snippet}
          {t.menu.moveDown}
        </MenuItem>
        <MenuItem disabled={count < 2 || !!busy} onSelect={() => onmoveto(page)}>
          {#snippet icon()}<ArrowUpDown />{/snippet}
          {t.menu.moveTo}
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={!!busy} onSelect={() => onreplaceimage(page)}>
          {#snippet icon()}<ImageUp />{/snippet}
          {page.imageKind ? t.menu.replaceImage : t.menu.addImage}
        </MenuItem>
        {#if page.imageKind}
          <MenuItem disabled={count < 2 || !!busy} onSelect={() => onmoveimage(page)}>
            {#snippet icon()}<ArrowRightLeft />{/snippet}
            {t.menu.moveImage}
          </MenuItem>
          <MenuItem disabled={!!busy} onSelect={() => onrights(page)}>
            {#snippet icon()}<Scale />{/snippet}
            {t.menu.rights}
          </MenuItem>
          <MenuItem disabled={!!busy} onSelect={() => onremoveimage(page)}>
            {#snippet icon()}<ImageOff />{/snippet}
            {t.menu.removeImage}
          </MenuItem>
        {/if}
        <MenuItem disabled={!!busy} onSelect={() => onshiftimages(page)}>
          {#snippet icon()}<ChevronsDown />{/snippet}
          {t.menu.shiftImages}
        </MenuItem>
        <MenuSeparator />
        <MenuItem danger disabled={!!busy} onSelect={() => onremove(page)}>
          {#snippet icon()}<Trash2 />{/snippet}
          {t.menu.remove}
        </MenuItem>
      </Menu>
    {/if}
  </div>
</article>
