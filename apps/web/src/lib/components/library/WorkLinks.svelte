<script lang="ts">
  /** Works as a list of links: author over title, a badge for a private work, and optionally a verb at the end of each row. */
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import { Badge } from '$lib/components/ui';
  import { site } from '$lib/strings/site';

  interface Item {
    id: string;
    slug: string;
    title: string;
    author: string | null;
    visibility?: 'public' | 'private';
  }

  interface Props {
    items: Item[];
    /** Where a row leads; the work's page when omitted. */
    href?: (item: Item) => string;
    /** What choosing a row starts, printed at its end. */
    action?: string;
  }

  let { items, href = (item) => `/works/${item.slug}`, action }: Props = $props();
</script>

<ul class="divide-y divide-line rounded-lg border border-line bg-surface">
  {#each items as work (work.id)}
    <li>
      <a href={href(work)} class="group flex items-center gap-4 px-5 py-3 hover:bg-sunken/40">
        <span class="min-w-0 flex-1">
          <span class="block font-sans text-xs text-ink-muted"
            >{work.author ?? site.works.unknownAuthor}</span
          >
          <span class="font-serif text-lg text-ink group-hover:text-accent">{work.title}</span>
        </span>
        {#if work.visibility === 'private'}<Badge>{site.works.private}</Badge>{/if}
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
