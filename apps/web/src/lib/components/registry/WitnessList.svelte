<script lang="ts">
  import { Badge } from '$lib/components/ui';
  import type { WorkTranscriptionRow } from '$lib/registry/types';
  import { registry } from '$lib/strings/registry';
  import CoverageBar from './CoverageBar.svelte';

  interface Props {
    /** The work's transcriptions, one row each, by siglum. */
    items: WorkTranscriptionRow[];
    /** The work's segments, for the coverage of each. */
    total: number;
  }

  let { items, total }: Props = $props();
</script>

<ul class="divide-y divide-line rounded-md border border-line bg-surface">
  {#each items as item (item.id)}
    <li class="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:flex-nowrap">
      <div class="min-w-56 flex-1 sm:min-w-0">
        <a
          href="/transcriptions/{item.id}"
          class="group inline-flex items-baseline gap-2.5 font-serif text-lg leading-snug text-ink"
        >
          <span class="min-w-5 font-bold">{item.witnessSiglum}</span>
          <span class="transition-colors group-hover:text-accent group-hover:underline"
            >{item.witnessName}</span
          >
        </a>
        <p class="mt-0.5 font-sans text-xs text-ink-soft">
          {item.name} · {registry.transcription.owner(item.ownerName)} ·
          <a href="/witnesses/{item.witnessSlug}" class="hover:text-ink hover:underline"
            >{registry.work.witnessPage}</a
          >
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-4">
        {#if item.visibility === 'draft'}<Badge>{registry.common.draft}</Badge>{/if}
        <CoverageBar n={item.segmentCount} {total} />
      </div>
    </li>
  {/each}
</ul>
