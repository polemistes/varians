<script lang="ts">
  /** Works as a list of links: author over title, and optionally a verb at the end of each row. */
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import WorkActions from '$lib/components/registry/WorkActions.svelte';
  import { site } from '$lib/strings/site';
  import type { WorkRights } from '$lib/work/actions';

  interface Item {
    id: string;
    slug: string;
    title: string;
    author: string | null;
    /** What the viewer may do with the work: an Edit button and the menu at the row's end for those who may change it. */
    can?: WorkRights;
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
    <li class="group flex items-center gap-4 pr-5 hover:bg-sunken/40">
      <a href={href(work)} class="flex min-w-0 flex-1 items-center gap-4 py-3 pl-5">
        <span class="min-w-0 flex-1">
          <span class="block font-sans text-xs text-ink-muted"
            >{work.author ?? site.works.unknownAuthor}</span
          >
          <span class="font-serif text-lg text-ink group-hover:text-accent">{work.title}</span>
        </span>
        {#if action}
          <span
            class="flex shrink-0 items-center gap-1 font-sans text-sm text-ink-soft group-hover:text-accent"
          >
            {action}<ArrowRight class="size-4" aria-hidden="true" />
          </span>
        {/if}
      </a>
      {#if work.can}
        <WorkActions {work} rights={work.can} place="list" />
      {/if}
    </li>
  {/each}
</ul>
