<script lang="ts">
  import { Badge, Button, LocalDate } from '$lib/components/ui';
  import type { WorkEditionRow } from '$lib/registry/types';
  import { and } from '$lib/strings/names';
  import { registry } from '$lib/strings/registry';

  type Item = Omit<WorkEditionRow, 'collaboratorIds'> & { canEdit: boolean };

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
      <div class="flex shrink-0 items-center gap-2">
        {#if item.visibility === 'draft'}<Badge>{registry.common.draft}</Badge>{/if}
        <Button href="/editions/{item.slug}" size="sm" variant={item.visibility === 'published' ? 'primary' : 'secondary'} aria-label={`${s.read}: ${item.title}`}>
          {s.read}
        </Button>
        {#if item.canEdit}
          <Button
            href="/editions/{item.slug}/edit"
            size="sm"
            variant="secondary"
            aria-label={`${s.editEdition}: ${item.title}`}
          >
            {s.editEdition}
          </Button>
        {/if}
      </div>
    </li>
  {/each}
</ul>
