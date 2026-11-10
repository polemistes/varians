<script lang="ts">
  import { Badge } from '$lib/components/ui';
  import type { WitnessTranscriptionRow } from '$lib/registry/types';
  import { registry } from '$lib/strings/registry';
  import RowMenu from './RowMenu.svelte';

  type Item = WitnessTranscriptionRow & { can: { rename: boolean; delete: boolean } };

  interface Props {
    items: Item[];
    onrename: (item: Item) => void;
    ondelete: (item: Item) => void;
  }

  let { items, onrename, ondelete }: Props = $props();

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
        {#if item.can.rename || item.can.delete}
          <RowMenu
            label={`${s.menu}: ${item.name}`}
            editLabel={s.rename}
            deleteLabel={s.delete}
            onedit={item.can.rename ? () => onrename(item) : undefined}
            ondelete={item.can.delete ? () => ondelete(item) : undefined}
          />
        {/if}
      </div>
    </li>
  {/each}
</ul>
