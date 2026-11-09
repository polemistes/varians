<script lang="ts">
  import { Badge } from '$lib/components/ui';
  import type { PageRow } from '$lib/registry/types';
  import { registry } from '$lib/strings/registry';

  interface Props {
    pages: PageRow[];
  }

  let { pages }: Props = $props();
</script>

<ul class="flex flex-wrap gap-2">
  {#each pages as page (page.id)}
    <li
      class="inline-flex items-center gap-2 rounded-md border border-line bg-surface py-1 pr-1.5 pl-2.5"
    >
      <span class="font-serif text-base text-ink">{page.label}</span>
      <Badge tone={page.hasImage ? 'accent' : 'neutral'}>
        {page.hasImage ? registry.witness.withImage : registry.witness.withoutImage}
      </Badge>
    </li>
  {/each}
</ul>
