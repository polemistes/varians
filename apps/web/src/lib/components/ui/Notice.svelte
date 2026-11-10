<script lang="ts">
  import type { Snippet } from 'svelte';
  import Info from '@lucide/svelte/icons/info';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import CircleCheck from '@lucide/svelte/icons/circle-check';

  interface Props {
    kind?: 'info' | 'warning' | 'error' | 'success';
    title?: string;
    children?: Snippet;
    class?: string;
  }

  let { kind = 'info', title, children, class: className }: Props = $props();

  const kinds = {
    info: { classes: 'border-line bg-sunken text-ink', icon: 'text-ink-soft', Icon: Info },
    warning: {
      classes: 'border-warning/25 bg-warning-soft text-ink',
      icon: 'text-warning',
      Icon: TriangleAlert,
    },
    error: {
      classes: 'border-danger/25 bg-danger-soft text-ink',
      icon: 'text-danger',
      Icon: CircleAlert,
    },
    success: {
      classes: 'border-success/25 bg-success-soft text-ink',
      icon: 'text-success',
      Icon: CircleCheck,
    },
  };
  const current = $derived(kinds[kind]);
</script>

<div
  role={kind === 'error' ? 'alert' : 'status'}
  class={[
    'flex items-start gap-3 rounded-md border px-3.5 py-3 font-sans text-sm',
    current.classes,
    className,
  ]}
>
  <current.Icon class={['mt-0.5 size-4 shrink-0', current.icon]} aria-hidden="true" />
  <div class="min-w-0 flex-1">
    {#if title}<p class="font-medium">{title}</p>{/if}
    {#if children}<div class={[title && 'mt-0.5', 'text-ink-soft']}>{@render children()}</div>{/if}
  </div>
</div>
