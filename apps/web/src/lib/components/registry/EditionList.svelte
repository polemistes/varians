<script lang="ts">
  /** The editions of a work: the name leads to the reader; Read, Edit and the menu for those who may edit. */
  import EditionActions from '$lib/components/edition/EditionActions.svelte';
  import { Badge, LocalDate } from '$lib/components/ui';
  import type { EditionRights } from '$lib/edition/actions';
  import type { WorkEditionRow } from '$lib/registry/types';
  import { and } from '$lib/strings/names';
  import { registry } from '$lib/strings/registry';

  type Item = Omit<WorkEditionRow, 'collaboratorIds'> & { can: EditionRights };

  interface Props {
    items: Item[];
  }

  let { items }: Props = $props();
  const s = registry.work;
</script>

<ul class="divide-y divide-line rounded-md border border-line bg-surface">
  {#each items as item (item.id)}
    <li class="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:flex-nowrap">
      <div class="min-w-56 flex-1 sm:min-w-0">
        <a
          href="/editions/{item.slug}"
          class="font-serif text-lg leading-snug text-ink transition-colors hover:text-accent hover:underline"
          >{item.title}</a
        >
        <p class="mt-0.5 font-sans text-xs text-ink-soft">
          {#if item.editors.length}{s.editionEditors(and(item.editors))} ·{/if}
          {s.editionBy(item.ownerName)} ·
          <LocalDate date={item.updatedAt} />
        </p>
      </div>
      {#if item.latestVersion === null}<Badge>{registry.common.draft}</Badge>{/if}
      <EditionActions
        edition={{
          id: item.id,
          slug: item.slug,
          title: item.title,
          published: item.latestVersion !== null,
        }}
        rights={item.can}
        place="list"
      />
    </li>
  {/each}
</ul>
