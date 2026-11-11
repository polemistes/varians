<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Badge, LocalDate } from '$lib/components/ui';

  interface Props {
    href: string;
    title: string;
    subtitle?: string;
    subtitleHref?: string;
    owner?: string | null;
    /** ISO date; shown in the reader's locale after mount. */
    date: string;
    badge?: string;
    /** What may be done with the record, at the row's end. */
    actions?: Snippet;
  }

  let { href, title, subtitle, subtitleHref, owner, date, badge, actions }: Props = $props();
</script>

<!-- With buttons at its end, the row's parts stand on its middle line; without, on the title's baseline. -->
<li
  class={[
    'flex flex-wrap gap-x-6 gap-y-1 px-4 py-3 sm:flex-nowrap',
    actions ? 'items-center' : 'items-baseline',
  ]}
>
  <div class="min-w-0 flex-1">
    <a
      {href}
      class="font-serif text-lg leading-snug text-ink transition-colors hover:text-accent hover:underline"
      >{title}</a
    >
    {#if subtitle}
      <p class="mt-0.5 font-sans text-xs text-ink-soft">
        {#if subtitleHref}
          <a href={subtitleHref} class="hover:text-ink hover:underline">{subtitle}</a>
        {:else}
          {subtitle}
        {/if}
      </p>
    {/if}
  </div>
  <div class="flex shrink-0 items-center gap-3 font-sans text-xs text-ink-muted">
    {#if badge}<Badge>{badge}</Badge>{/if}
    {#if owner}<span class="max-w-40 truncate">{owner}</span>{/if}
    <LocalDate {date} />
  </div>
  <!-- The room of a row's actions is one width for every row, so that the dates stand in line. -->
  {#if actions}<div class="flex w-44 shrink-0 justify-end">{@render actions()}</div>{/if}
</li>
