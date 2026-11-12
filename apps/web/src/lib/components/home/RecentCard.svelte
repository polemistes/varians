<script lang="ts">
  /**
   * A piece of one's own work, to go straight back to it. An edition's name
   * leads to the reader, with Read, Edit and its menu at the card's foot; a
   * transcript's name leads to the workbench, with its menu there. The name
   * is the link, stretched over the card, so that no control lies inside it.
   */
  import EditionActions from '$lib/components/edition/EditionActions.svelte';
  import TranscriptionActions from '$lib/components/transcription/TranscriptionActions.svelte';
  import { LocalDate } from '$lib/components/ui';
  import VersionBadge from '$lib/components/version/VersionBadge.svelte';
  import type { EditionRights } from '$lib/edition/actions';
  import { site } from '$lib/strings/site';
  import type { TranscriptionRights } from '$lib/transcription/actions';

  type Common = {
    id: string;
    latestVersion: number | null;
    updatedAt: string;
    shared: boolean;
  };
  type RecentItem =
    | (Common & {
        kind: 'edition';
        slug: string;
        title: string;
        workTitle: string;
        can: EditionRights;
      })
    | (Common & {
        kind: 'transcription';
        name: string;
        witnessName: string;
        can: TranscriptionRights;
      });

  interface Props {
    item: RecentItem;
  }

  let { item }: Props = $props();
  const t = site.home;

  const cardClass =
    'group flex h-full flex-col gap-1 rounded-lg border border-line bg-surface px-5 py-4 transition-colors hover:border-accent/50 hover:bg-sunken/40';
</script>

{#snippet head(kind: string)}
  <span class="flex flex-wrap items-center gap-2 font-sans text-xs text-ink-muted">
    <span class="font-medium tracking-[0.08em] uppercase">{kind}</span>
    <VersionBadge latestVersion={item.latestVersion} />
    {#if item.shared}<span>{t.shared}</span>{/if}
  </span>
{/snippet}

{#snippet changed()}
  <span class="mt-auto pt-1 font-sans text-xs text-ink-muted"
    >{t.changed} <LocalDate date={item.updatedAt} /></span
  >
{/snippet}

{#if item.kind === 'edition'}
  <article class={['relative', cardClass]}>
    {@render head(t.edition)}
    <span class="font-serif text-lg leading-snug text-ink group-hover:text-accent">
      <a
        href="/editions/{item.slug}"
        class="rounded-lg outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-accent"
        >{item.title}</a
      >
    </span>
    <span class="font-sans text-sm text-ink-soft">{t.editionOf(item.workTitle)}</span>
    {@render changed()}
    <EditionActions
      edition={{
        id: item.id,
        slug: item.slug,
        title: item.title,
        published: item.latestVersion !== null,
      }}
      rights={item.can}
      place="list"
      class="relative z-10 justify-end pt-2"
    />
  </article>
{:else}
  <article class={['relative', cardClass]}>
    {@render head(t.transcription)}
    <span class="font-serif text-lg leading-snug text-ink group-hover:text-accent">
      <a
        href="/transcriptions/{item.id}"
        class="rounded-lg outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-accent"
        >{item.name}</a
      >
    </span>
    <span class="font-sans text-sm text-ink-soft">{t.transcriptionOf(item.witnessName)}</span>
    {@render changed()}
    <TranscriptionActions
      transcription={item}
      rights={item.can}
      place="list"
      class="relative z-10 justify-end pt-2"
    />
  </article>
{/if}
