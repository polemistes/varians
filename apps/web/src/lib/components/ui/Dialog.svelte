<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Dialog } from 'bits-ui';
  import X from '@lucide/svelte/icons/x';
  import { s } from '$lib/strings';

  interface Props {
    open?: boolean;
    title: string;
    description?: string;
    size?: 'sm' | 'md' | 'lg';
    /** Renders the element that opens the dialog; spread the props onto it. */
    trigger?: Snippet<[{ props: Record<string, unknown> }]>;
    children?: Snippet;
    /** Buttons, aligned to the end. */
    footer?: Snippet;
    onOpenChange?: (open: boolean) => void;
  }

  let {
    open = $bindable(false),
    title,
    description,
    size = 'md',
    trigger,
    children,
    footer,
    onOpenChange,
  }: Props = $props();

  const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' };
</script>

<Dialog.Root bind:open {onOpenChange}>
  {#if trigger}
    <Dialog.Trigger>
      {#snippet child({ props })}
        {@render trigger({ props })}
      {/snippet}
    </Dialog.Trigger>
  {/if}
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-ink/30 animate-fade-in" />
    <Dialog.Content
      class={[
        'fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-6 font-sans shadow-pop outline-none animate-rise-in',
        sizes[size],
      ]}
    >
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <Dialog.Title class="text-base font-semibold text-ink">{title}</Dialog.Title>
          {#if description}
            <Dialog.Description class="mt-1 text-sm text-ink-soft">{description}</Dialog.Description>
          {/if}
        </div>
        <Dialog.Close
          class="-mt-1 -mr-2 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
          aria-label={s.common.close}
        >
          <X class="size-4" aria-hidden="true" />
        </Dialog.Close>
      </div>
      {#if children}
        <div class="mt-4 text-sm text-ink">{@render children()}</div>
      {/if}
      {#if footer}
        <div class="mt-6 flex flex-wrap justify-end gap-2">{@render footer()}</div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
