<script lang="ts">
  /** Witnesses as a list of links: siglum, name, and where each is kept; optionally a verb at the end of each row. */
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import { registry } from '$lib/strings/registry';

  interface Item {
    id: string;
    slug: string;
    name: string;
    siglum: string;
    category: string;
    repository?: string | null;
    settlement?: string | null;
    shelfmark?: string | null;
  }

  interface Props {
    items: Item[];
    /** Where a row leads; the witness's page when omitted. */
    href?: (item: Item) => string;
    /** What choosing a row starts, printed at its end. */
    action?: string;
  }

  let { items, href = (item) => `/witnesses/${item.slug}`, action }: Props = $props();

  function detail(w: Item): string {
    const place = [w.settlement, w.repository].filter(Boolean).join(', ');
    return [registry.witness.categories[w.category] ?? w.category, place, w.shelfmark]
      .filter(Boolean)
      .join(' · ');
  }
</script>

<ul class="divide-y divide-line rounded-lg border border-line bg-surface">
  {#each items as witness (witness.id)}
    <li>
      <a href={href(witness)} class="group flex items-center gap-4 px-5 py-3 hover:bg-sunken/40">
        <span class="w-10 shrink-0 font-serif text-lg text-ink-soft">{witness.siglum}</span>
        <span class="min-w-0 flex-1">
          <span class="font-serif text-lg text-ink group-hover:text-accent">{witness.name}</span>
          <span class="block font-sans text-xs text-ink-muted">{detail(witness)}</span>
        </span>
        {#if action}
          <span
            class="flex shrink-0 items-center gap-1 font-sans text-sm text-ink-soft group-hover:text-accent"
          >
            {action}<ArrowRight class="size-4" aria-hidden="true" />
          </span>
        {/if}
      </a>
    </li>
  {/each}
</ul>
