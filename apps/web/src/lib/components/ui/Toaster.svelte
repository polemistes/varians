<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Info from '@lucide/svelte/icons/info';
  import { s } from '$lib/strings';
  import { toasts } from './toast.svelte';

  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  $effect(() => {
    const live = new Set<number>();
    for (const toast of toasts.items) {
      live.add(toast.id);
      if (toast.duration > 0 && !timers.has(toast.id)) {
        timers.set(
          toast.id,
          setTimeout(() => {
            timers.delete(toast.id);
            toasts.dismiss(toast.id);
          }, toast.duration),
        );
      }
    }
    for (const [id, timer] of timers) {
      if (!live.has(id)) {
        clearTimeout(timer);
        timers.delete(id);
      }
    }
  });

  $effect(() => () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  });

  const icons = { info: Info, success: CircleCheck, error: CircleAlert };
  const colours = { info: 'text-ink-soft', success: 'text-success', error: 'text-danger' };
</script>

<div
  class="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
  role="status"
  aria-live="polite"
>
  {#each toasts.items as toast (toast.id)}
    {@const Icon = icons[toast.kind]}
    <div
      class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border border-line bg-surface px-3.5 py-3 font-sans text-sm text-ink shadow-pop animate-rise-in"
    >
      <Icon class={['mt-0.5 size-4 shrink-0', colours[toast.kind]]} aria-hidden="true" />
      <p class="min-w-0 flex-1">{toast.message}</p>
      <button
        type="button"
        class="-m-1 inline-flex size-7 shrink-0 items-center justify-center rounded text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
        aria-label={s.common.dismiss}
        onclick={() => toasts.dismiss(toast.id)}
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </div>
  {/each}
</div>
