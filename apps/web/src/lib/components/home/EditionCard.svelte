<script lang="ts">
  /** A published edition as readers meet it: the work, the edition's title, its editors. */
  import { and } from '$lib/strings/names';
  import { site } from '$lib/strings/site';

  interface Props {
    slug: string;
    title: string;
    workTitle: string;
    workAuthor: string | null;
    editors: string[];
  }

  let { slug, title, workTitle, workAuthor, editors }: Props = $props();
</script>

<a
  href="/editions/{slug}"
  class="group flex h-full flex-col gap-1.5 rounded-lg border border-line bg-surface px-5 py-4 transition-colors hover:border-accent/50 hover:bg-sunken/40"
>
  <span class="font-sans text-xs font-medium tracking-[0.08em] text-ink-muted uppercase"
    >{workAuthor ? `${workAuthor}, ${workTitle}` : workTitle}</span
  >
  <span class="font-serif text-xl leading-snug text-ink group-hover:text-accent">{title}</span>
  {#if editors.length}<span class="font-serif text-sm text-ink-soft italic"
      >{site.editions.editedBy(and(editors))}</span
    >{/if}
</a>
