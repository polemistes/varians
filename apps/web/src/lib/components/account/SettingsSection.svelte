<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    hint?: string;
    children: Snippet;
  }

  let { title, hint, children }: Props = $props();
  const uid = $props.id();
  const headingId = `settings-${uid}`;
</script>

<section aria-labelledby={headingId} class="grid gap-6 border-t border-line py-10 first:border-t-0 first:pt-0 md:grid-cols-[14rem_1fr]">
  <div>
    <h2 id={headingId} class="font-sans text-base font-semibold text-ink">{title}</h2>
    {#if hint}<p class="mt-1 font-sans text-sm text-ink-soft">{hint}</p>{/if}
  </div>
  <div class="max-w-narrow">{@render children()}</div>
</section>
