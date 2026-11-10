<script lang="ts">
  /** The entries merged into this one, with the date of each merge. */
  import { LocalDate } from '$lib/components/ui';

  interface Props {
    items: { oldId: string; label: string; mergedAt: string }[];
  }

  let { items }: Props = $props();
</script>

<ul class="flex flex-col gap-0.5">
  {#each items as item (item.oldId)}
    <li>
      <span class="font-serif text-base text-ink">{item.label}</span><span class="text-ink-soft"
        >, <LocalDate date={item.mergedAt} /></span
      >
    </li>
  {/each}
</ul>
