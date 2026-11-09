<script lang="ts">
  import { registry } from '$lib/strings/registry';

  interface Props {
    /** The labels in the order of the work, consecutive ones joined into ranges: 1.1–1.611. */
    ranges: string[];
  }

  let { ranges }: Props = $props();
</script>

<details class="group rounded-md border border-line bg-surface">
  <summary
    class="cursor-pointer list-none rounded-md px-4 py-2.5 font-sans text-sm text-ink select-none hover:bg-sunken focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden"
  >
    <span class="inline-block transition-transform group-open:rotate-90" aria-hidden="true">›</span>
    <span class="ml-1.5">{registry.work.showSegments}</span>
  </summary>
  <p class="border-t border-line px-4 py-3 font-serif text-base leading-relaxed text-ink-soft">
    {#each ranges as range, i (i)}<span class="whitespace-nowrap">{range}</span
      >{#if i < ranges.length - 1}<span class="text-ink-muted" aria-hidden="true">{' · '}</span
        >{/if}{/each}
  </p>
</details>
