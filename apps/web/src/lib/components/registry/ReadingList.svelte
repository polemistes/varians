<script lang="ts">
  import { citedText } from '$lib/registry/citations';
  import type { Cited, ReadingRow, RowRights } from '$lib/registry/types';
  import { recordActions } from '$lib/strings/record-actions';
  import { registry } from '$lib/strings/registry';
  import RowActions from './RowActions.svelte';

  type Item = ReadingRow & { can: RowRights; citations?: Cited[] };

  interface Props {
    items: Item[];
    /** On a witness's page: name the work of each reading instead of the witness. */
    show?: 'witness' | 'work';
    onedit: (item: Item) => void;
    ondelete: (item: Item) => void;
  }

  let { items, show = 'witness', onedit, ondelete }: Props = $props();

  const s = registry.reading;
</script>

<ul class="divide-y divide-line rounded-md border border-line bg-surface">
  {#each items as item (item.id)}
    {@const cited = citedText(item.citations)}
    <li
      class="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:gap-x-4"
    >
      <span class="pt-px font-serif text-base text-ink-soft tabular-nums">{item.label}</span>
      <div class="min-w-0">
        <p class="font-serif text-base leading-snug text-ink">
          {#if item.lemma}{item.lemma}<span class="mr-1.5 text-ink-muted" aria-hidden="true">]</span
            >{/if}
          {#if item.reading}{item.reading}{:else}<span
              class="font-sans text-sm text-ink-soft italic">{s.omits}</span
            >{/if}
          {#if show === 'witness'}
            <a
              href="/witnesses/{item.witnessSlug}"
              class="ml-2 text-ink-soft hover:text-accent hover:underline"
              title={item.witnessName}>{item.witnessSiglum}</a
            >
          {/if}
          {#if cited}<span class="ml-2 font-sans text-sm text-ink-soft">{cited}</span>{/if}
        </p>
        {#if item.note}<p class="mt-1 font-sans text-sm text-ink-soft">{item.note}</p>{/if}
        <p class="mt-1 font-sans text-xs text-ink-muted">
          {#if show === 'work'}
            <a href="/works/{item.work.slug}" class="hover:text-ink hover:underline"
              >{item.work.title}</a
            > ·
          {:else}
            {item.witnessName} ·
          {/if}
          {#if item.source}{item.source} ·{/if}
          {registry.conjecture.enteredBy(item.ownerName)}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <RowActions
          kind="reading"
          rights={item.can}
          label={recordActions.menuOf(`${item.label} ${item.witnessSiglum}`)}
          onedit={() => onedit(item)}
          ondelete={() => ondelete(item)}
        />
      </div>
    </li>
  {/each}
</ul>
