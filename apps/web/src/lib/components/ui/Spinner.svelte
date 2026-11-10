<script lang="ts">
  import { s } from '$lib/strings';

  interface Props {
    size?: 'sm' | 'md' | 'lg';
    /** Announced to screen readers; omit when the surrounding control explains the wait. */
    label?: string;
    class?: string;
  }

  let { size = 'md', label, class: className }: Props = $props();

  const sizes = { sm: 'size-4', md: 'size-5', lg: 'size-8' };
</script>

<svg
  class={['animate-spin text-current', sizes[size], className]}
  viewBox="0 0 24 24"
  fill="none"
  role={label ? 'status' : undefined}
  aria-hidden={label ? undefined : 'true'}
  aria-label={label ?? undefined}
>
  <circle class="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" />
  <path
    class="opacity-90"
    d="M21 12a9 9 0 0 0-9-9"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
  />
  {#if label}<title>{label ?? s.common.loading}</title>{/if}
</svg>
