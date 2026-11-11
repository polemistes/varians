<script lang="ts">
  import TranscriptionActions from '$lib/components/transcription/TranscriptionActions.svelte';
  import { Badge } from '$lib/components/ui';
  import type { WitnessTranscriptionRow } from '$lib/registry/types';
  import { registry } from '$lib/strings/registry';
  import type { TranscriptionRights } from '$lib/transcription/actions';

  type Item = WitnessTranscriptionRow & { can: TranscriptionRights };

  interface Props {
    items: Item[];
  }

  let { items }: Props = $props();

  const s = registry.transcription;

  /** The works a row names: those it assigns text to, and the work it was made for when that has none yet. */
  function worksOf(item: Item) {
    const list = item.assigned.map((w) => ({ slug: w.slug, title: w.title, n: w.segmentCount }));
    for (const work of [...item.works].reverse()) {
      if (!list.some((w) => w.slug === work.slug))
        list.unshift({ slug: work.slug, title: work.title, n: 0 });
    }
    return list;
  }
</script>

<ul class="divide-y divide-line rounded-md border border-line bg-surface">
  {#each items as item (item.id)}
    {@const works = worksOf(item)}
    <li class="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:flex-nowrap">
      <div class="min-w-56 flex-1 sm:min-w-0">
        <a
          href="/transcriptions/{item.id}"
          class="font-serif text-lg leading-snug text-ink transition-colors hover:text-accent hover:underline"
          >{item.name}</a
        >
        <p class="mt-0.5 font-sans text-xs text-ink-soft">
          {#each works as work, i (work.slug)}
            <a href="/works/{work.slug}" class="text-ink hover:text-accent hover:underline"
              >{work.title}</a
            >:
            {s.segmentCount(work.n)}{#if i < works.length - 1};{' '}{/if}
          {:else}
            {s.unassigned}
          {/each}
          · {s.owner(item.ownerName)}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        {#if item.visibility === 'draft'}<Badge>{s.draft}</Badge>{/if}
        <!-- A row without a menu keeps its room, so that the badges stand in line. -->
        <div class="w-8 shrink-0">
          <TranscriptionActions transcription={item} rights={item.can} place="list" />
        </div>
      </div>
    </li>
  {/each}
</ul>
