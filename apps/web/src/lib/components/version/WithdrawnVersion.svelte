<script lang="ts">
  /**
   * The page of a withdrawn version, of an edition or a transcript: the
   * record as the version named it, the citation of the version, when it was
   * published and the note on it, when it was withdrawn and the note readers
   * were left, a link to the latest version while one stands, and the list of
   * versions. No text: the address stays because someone may have cited it.
   */
  import { PageFrame } from '$lib/components/shell';
  import { LocalDate, Notice } from '$lib/components/ui';
  import type { ReaderVersion } from '$lib/reader/types';
  import { s } from '$lib/strings';
  import { versions as v } from '$lib/strings/versions';

  interface Props {
    /** Above the title: the author and work, or the witness. */
    kicker: string;
    title: string;
    /** Under the title: who edited the edition, or whose transcript it is. */
    byline: string | null;
    number: number;
    at: string;
    note: string | null;
    withdrawn: { at: string; note: string | null };
    citation: string;
    /** The address of the latest version, or null while none stands. */
    current: string | null;
    versions: ReaderVersion[];
  }

  let { kicker, title, byline, number, at, note, withdrawn, citation, current, versions }: Props =
    $props();
</script>

<svelte:head>
  <title>{title} · {v.version(number)} · {s.app.name}</title>
</svelte:head>

<PageFrame width="reading">
  <header class="mb-8">
    <p class="font-sans text-xs font-medium tracking-[0.12em] text-ink-muted uppercase">
      {kicker}
    </p>
    <h1 class="mt-2 font-serif text-title text-ink">{title}</h1>
    {#if byline}<p class="mt-1.5 font-serif text-lg text-ink-soft italic">{byline}</p>{/if}
    <p class="mt-3 font-sans text-xs text-ink-muted">
      {v.published(number)}
      <LocalDate date={at} />
    </p>
    {#if note}<p class="mt-1 font-sans text-sm whitespace-pre-line text-ink-soft">{note}</p>{/if}
  </header>

  <Notice kind="warning">
    <span class="font-medium text-ink"
      >{v.withdrawnPage.withdrawn} <LocalDate date={withdrawn.at} /></span
    >{#if withdrawn.note}<span class="mt-1 block whitespace-pre-line">{withdrawn.note}</span>{/if}
    {#if current}<a href={current} class="mt-1 block text-accent underline"
        >{v.withdrawnPage.readLatest}</a
      >{/if}
  </Notice>

  <section class="mt-8 font-sans text-sm text-ink-soft">
    <h2 class="text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
      {v.withdrawnPage.cite}
    </h2>
    <p class="mt-1">{citation}</p>
  </section>

  <section class="mt-6 font-sans text-sm">
    <h2 class="text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
      {v.menu.label}
    </h2>
    <ul class="mt-1 space-y-1.5">
      {#each versions as version (version.number)}
        <li>
          <a href={version.href} class="text-accent hover:underline">{v.version(version.number)}</a>
          <span class="text-ink-muted"
            >(<LocalDate date={version.at} />{version.current
              ? `, ${v.menu.current}`
              : ''}{version.withdrawn ? `, ${v.menu.withdrawn}` : ''})</span
          >
          {#if version.note}<span class="block whitespace-pre-line text-ink-soft"
              >{version.note}</span
            >{/if}
        </li>
      {/each}
    </ul>
  </section>
</PageFrame>
