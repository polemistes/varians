<script lang="ts">
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
  }

  let { href, title, subtitle, subtitleHref, owner, date, badge }: Props = $props();
</script>

<li class="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-3 sm:flex-nowrap">
  <div class="min-w-0 flex-1">
    <a {href} class="font-serif text-lg leading-snug text-ink transition-colors hover:text-accent hover:underline">{title}</a>
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
</li>
