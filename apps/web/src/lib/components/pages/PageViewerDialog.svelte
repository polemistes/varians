<script lang="ts">
  /**
   * A page's image, large, in the facsimile viewer (pan and zoom only), with
   * the previous and next pages a button or Page Up / Page Down away. The
   * viewer needs the browser, so it is loaded when the dialog first opens.
   */
  import { Dialog } from 'bits-ui';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import X from '@lucide/svelte/icons/x';
  import { IconButton, Spinner } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import { pageStrings as t } from '$lib/strings/pages';
  import type { PageView } from './types';

  type Viewer = typeof import('$lib/components/facsimile/FacsimileViewer.svelte').default;

  interface Props {
    /** The pages that have an image, in order. */
    pages: PageView[];
    /** The id of the page shown; null when the dialog is closed. */
    current?: string | null;
  }

  let { pages, current = $bindable(null) }: Props = $props();

  const index = $derived(current ? pages.findIndex((p) => p.id === current) : -1);
  const page = $derived(index >= 0 ? pages[index]! : null);

  let FacsimileViewer = $state<Viewer | null>(null);
  let loadFailed = $state(false);

  $effect(() => {
    if (page && !FacsimileViewer && !loadFailed) {
      import('$lib/components/facsimile/FacsimileViewer.svelte')
        .then((module) => (FacsimileViewer = module.default))
        .catch(() => (loadFailed = true));
    }
  });

  function go(step: number) {
    const next = pages[index + step];
    if (next) current = next.id;
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'PageUp') {
      event.preventDefault();
      go(-1);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      go(1);
    }
  }
</script>

<Dialog.Root
  bind:open={
    () => page !== null,
    (open) => {
      if (!open) current = null;
    }
  }
>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-ink/50 animate-fade-in" />
    <Dialog.Content
      class="fixed top-1/2 left-1/2 z-50 flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[96rem] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-surface font-sans shadow-pop outline-none animate-rise-in"
      onkeydown={keydown}
    >
      <div class="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <div class="min-w-0 flex-1">
          <Dialog.Title class="truncate text-base font-semibold text-ink">{page ? t.viewer.title(page.label) : ''}</Dialog.Title>
          <Dialog.Description class="text-xs text-ink-soft tabular-nums">
            {page ? t.viewer.of(index + 1, pages.length) : ''}
          </Dialog.Description>
        </div>
        <IconButton label={t.viewer.previous} disabled={index <= 0} onclick={() => go(-1)}>
          <ChevronLeft aria-hidden="true" />
        </IconButton>
        <IconButton label={t.viewer.next} disabled={index < 0 || index >= pages.length - 1} onclick={() => go(1)}>
          <ChevronRight aria-hidden="true" />
        </IconButton>
        <Dialog.Close
          class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
          aria-label={s.common.close}
        >
          <X class="size-4" aria-hidden="true" />
        </Dialog.Close>
      </div>
      <div class="relative min-h-0 flex-1">
        {#if page?.source && FacsimileViewer}
          <FacsimileViewer source={page.source} mode="pan" editable={false} labels={t.viewer.labels} class="h-full" />
        {:else if loadFailed}
          <p class="absolute inset-0 grid place-items-center text-sm text-ink-soft">{t.errors.generic}</p>
        {:else}
          <div class="absolute inset-0 grid place-items-center text-ink-soft">
            <Spinner label={t.viewer.loading} />
          </div>
        {/if}
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
