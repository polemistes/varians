<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
    children: Snippet;
    class?: string;
  }

  let { tone = 'neutral', children, class: className }: Props = $props();

  const tones = {
    neutral: 'border-line bg-sunken text-ink-soft',
    accent: 'border-accent/20 bg-accent-soft text-accent',
    success: 'border-success/20 bg-success-soft text-success',
    warning: 'border-warning/20 bg-warning-soft text-warning',
    danger: 'border-danger/20 bg-danger-soft text-danger',
  };
</script>

<span
  class={[
    'inline-flex items-center rounded-full border px-2 py-0.5 font-sans text-xs font-medium whitespace-nowrap',
    tones[tone],
    className,
  ]}
>
  {@render children()}
</span>
