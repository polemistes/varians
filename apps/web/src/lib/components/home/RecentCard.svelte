<script lang="ts">
  /** A piece of one's own work, to go straight back into it: an edition opens in its editor, a transcription in the workbench. */
  import { Badge, LocalDate } from '$lib/components/ui';
  import { site } from '$lib/strings/site';

  type Common = { id: string; visibility: 'draft' | 'published'; updatedAt: string; shared: boolean };
  type RecentItem =
    | (Common & { kind: 'edition'; slug: string; title: string; workTitle: string })
    | (Common & { kind: 'transcription'; name: string; witnessName: string });

  interface Props {
    item: RecentItem;
  }

  let { item }: Props = $props();
  const t = site.home;

  const href = $derived(item.kind === 'edition' ? `/editions/${item.slug}/edit` : `/transcriptions/${item.id}`);
  const title = $derived(item.kind === 'edition' ? item.title : item.name);
  const context = $derived(item.kind === 'edition' ? t.editionOf(item.workTitle) : t.transcriptionOf(item.witnessName));
</script>

<a {href} class="group flex h-full flex-col gap-1 rounded-lg border border-line bg-surface px-5 py-4 transition-colors hover:border-accent/50 hover:bg-sunken/40">
  <span class="flex flex-wrap items-center gap-2 font-sans text-xs text-ink-muted">
    <span class="font-medium tracking-[0.08em] uppercase">{item.kind === 'edition' ? t.edition : t.transcription}</span>
    {#if item.visibility === 'published'}<Badge tone="success">{t.published}</Badge>{/if}
    {#if item.shared}<span>{t.shared}</span>{/if}
  </span>
  <span class="font-serif text-lg leading-snug text-ink group-hover:text-accent">{title}</span>
  <span class="font-sans text-sm text-ink-soft">{context}</span>
  <span class="mt-auto pt-1 font-sans text-xs text-ink-muted">{t.changed} <LocalDate date={item.updatedAt} /></span>
</a>
