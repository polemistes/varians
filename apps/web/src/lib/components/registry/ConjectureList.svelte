<script lang="ts">
  import { citedText } from '$lib/registry/citations';
  import type { Cited, ConjectureRow, RowRights } from '$lib/registry/types';
  import { recordActions } from '$lib/strings/record-actions';
  import { registry } from '$lib/strings/registry';
  import RowActions from './RowActions.svelte';

  type Item = ConjectureRow & { can: RowRights; citations?: Cited[] };

  interface Props {
    items: Item[];
    onedit: (item: Item) => void;
    ondelete: (item: Item) => void;
  }

  let { items, onedit, ondelete }: Props = $props();

  const s = registry.conjecture;
  const kindOf = (item: Item) => s.kinds[item.kind] ?? item.kind;
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
          {#if item.kind === 'lacuna'}
            <span class="font-sans text-sm text-ink-soft italic">{s.lacuna(item.extent)}</span>
          {:else if item.reading}
            {item.reading}
          {:else}
            <span class="font-sans text-sm text-ink-soft italic">{kindOf(item)}</span>
          {/if}
          {#if item.proposer}<span class="ml-2 text-ink-soft">{item.proposer}</span>{/if}
          {#if cited}<span class="ml-2 font-sans text-sm text-ink-soft">{cited}</span>{/if}
        </p>
        {#if item.note}<p class="mt-1 font-sans text-sm text-ink-soft">{item.note}</p>{/if}
        <p class="mt-1 font-sans text-xs text-ink-muted">
          {kindOf(item)} · {s.enteredBy(item.ownerName)}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <RowActions
          kind="conjecture"
          rights={item.can}
          label={recordActions.menuOf(`${item.label} ${item.lemma}`.trim())}
          onedit={() => onedit(item)}
          ondelete={() => ondelete(item)}
        />
      </div>
    </li>
  {/each}
</ul>
