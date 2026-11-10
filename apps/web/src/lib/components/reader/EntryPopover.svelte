<script lang="ts" module>
  import type { Variant } from '$lib/reader/variant';

  export interface PopoverEntry {
    key: string;
    label: string;
    variant: Variant;
    permalink: string | null;
  }
</script>

<script lang="ts">
  /**
   * The variant window on the word or the point a reader clicked or tapped:
   * what the witnesses have there, as a list, in a popover anchored to the
   * mark. It has no trigger of its own: the page opens it with the mark as
   * its anchor, and focus goes back to the mark (or to the card of the list
   * of variants that opened it) when it closes.
   */
  import { Popover } from 'bits-ui';
  import Link2 from '@lucide/svelte/icons/link-2';
  import X from '@lucide/svelte/icons/x';
  import ScrollText from '@lucide/svelte/icons/scroll-text';
  import ImageIcon from '@lucide/svelte/icons/image';
  import { reader as r } from '$lib/strings/reader';
  import PlaceWords from '../variant/PlaceWords.svelte';
  import VariantWindow from './VariantWindow.svelte';

  interface Props {
    open?: boolean;
    anchor: HTMLElement | null;
    entries: PopoverEntry[];
    /** The language of the text, for the quoted words. */
    lang: string;
    /** Whether any witness has a text to show beside the edition. */
    witnesses: boolean;
    onwitness?: () => void;
    onfacsimile?: () => void;
    /** A siglum of the window: the witness it opens, and the variant's key. */
    onsiglum?: (siglum: string, key: string) => void;
    /** A link of the window to another variant of the segment. */
    onopen?: (key: string, from: HTMLElement) => void;
    /** Called when the popover has closed, to give focus back. */
    onclosed?: () => void;
  }

  let {
    open = $bindable(false),
    anchor,
    entries,
    lang,
    witnesses,
    onwitness,
    onfacsimile,
    onsiglum,
    onopen,
    onclosed,
  }: Props = $props();

  const title = $derived(entries[0] ? r.entry.title(entries[0].label) : '');
</script>

<Popover.Root bind:open>
  <Popover.Portal>
    <Popover.Content
      customAnchor={anchor}
      side="bottom"
      align="start"
      sideOffset={8}
      collisionPadding={12}
      role="dialog"
      aria-label={title}
      onInteractOutside={(event) => {
        // Another word with variants, or a place in the list of variants, moves the popover rather than closing it.
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('[data-sites][role="button"], [data-variant-place]'))
          event.preventDefault();
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        onclosed?.();
      }}
      class="z-50 max-h-[min(30rem,70dvh)] w-[min(25rem,calc(100vw-1.5rem))] overflow-y-auto rounded-md border border-line bg-surface p-4 font-sans text-sm text-ink shadow-pop outline-none animate-fade-in"
    >
      {#each entries as item, k (item.key)}
        <section class={[k > 0 && 'mt-4 border-t border-line pt-3']}>
          <header class="mb-2 flex items-center gap-2">
            <h2 class="text-xs font-semibold tracking-wide text-ink-muted tabular-nums">
              {item.label}
            </h2>
            {#if item.permalink}
              <a
                href={item.permalink}
                data-sveltekit-noscroll
                class="inline-flex size-6 items-center justify-center rounded text-ink-muted hover:bg-sunken hover:text-ink"
                title={r.text.permalink(item.label)}
                aria-label={r.text.permalink(item.label)}
              >
                <Link2 class="size-3.5" aria-hidden="true" />
              </a>
            {/if}
            {#if k === 0}
              <Popover.Close
                class="ml-auto inline-flex size-6 items-center justify-center rounded text-ink-muted hover:bg-sunken hover:text-ink"
                aria-label={r.entry.close}
              >
                <X class="size-4" aria-hidden="true" />
              </Popover.Close>
            {/if}
          </header>
          <p class="mb-2.5 text-[1.3rem] leading-snug">
            <PlaceWords variant={item.variant} {lang} />
          </p>
          <VariantWindow variant={item.variant} {lang} onwitness={onsiglum} {onopen} />
        </section>
      {/each}
      {#if witnesses}
        <footer class="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
          <button
            type="button"
            class="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-ink-soft hover:bg-sunken hover:text-ink"
            onclick={() => onwitness?.()}
          >
            <ScrollText class="size-3.5" aria-hidden="true" />
            {r.entry.showWitness}
          </button>
          <button
            type="button"
            class="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-ink-soft hover:bg-sunken hover:text-ink"
            onclick={() => onfacsimile?.()}
          >
            <ImageIcon class="size-3.5" aria-hidden="true" />
            {r.entry.showFacsimile}
          </button>
        </footer>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
