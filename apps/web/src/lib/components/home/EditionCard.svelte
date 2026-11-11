<script lang="ts">
  /**
   * A published edition as readers meet it: the work, the edition's title,
   * its editors. The card leads to the reader; for those who may edit it,
   * Read, Edit and the edition's menu stand at its foot. The title is the
   * link, stretched over the card, so that no control lies inside it.
   */
  import EditionActions from '$lib/components/edition/EditionActions.svelte';
  import type { EditionRights } from '$lib/edition/actions';
  import { and } from '$lib/strings/names';
  import { site } from '$lib/strings/site';

  interface Props {
    id: string;
    slug: string;
    title: string;
    workTitle: string;
    workAuthor: string | null;
    editors: string[];
    visibility: 'draft' | 'published';
    can: EditionRights;
  }

  let { id, slug, title, workTitle, workAuthor, editors, visibility, can }: Props = $props();
</script>

<article
  class="group relative flex h-full flex-col gap-1.5 rounded-lg border border-line bg-surface px-5 py-4 transition-colors hover:border-accent/50 hover:bg-sunken/40"
>
  <span class="font-sans text-xs font-medium tracking-[0.08em] text-ink-muted uppercase"
    >{workAuthor ? `${workAuthor}, ${workTitle}` : workTitle}</span
  >
  <span class="font-serif text-xl leading-snug text-ink group-hover:text-accent">
    <a
      href="/editions/{slug}"
      class="rounded-lg outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-accent"
      >{title}</a
    >
  </span>
  {#if editors.length}<span class="font-serif text-sm text-ink-soft italic"
      >{site.editions.editedBy(and(editors))}</span
    >{/if}
  {#if can.edit}
    <EditionActions
      edition={{ id, slug, title, published: visibility === 'published' }}
      rights={can}
      place="list"
      class="relative z-10 mt-auto justify-end pt-3"
    />
  {/if}
</article>
