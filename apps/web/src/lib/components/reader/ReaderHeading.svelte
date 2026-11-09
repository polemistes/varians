<script lang="ts">
  /**
   * The head of the edition: what state of it is shown (a draft, a preview,
   * an earlier version), the author and work, the title, the editors, the
   * version line, and the preface, folded until opened and printed open.
   */
  import { LocalDate, Notice } from '$lib/components/ui';
  import type { ReaderData } from '$lib/reader/types';
  import { and } from '$lib/strings/names';
  import { reader as r } from '$lib/strings/reader';

  interface Props {
    data: Pick<ReaderData, 'edition' | 'work' | 'mode' | 'links' | 'worksCited'>;
    /** A permalink's label the edition does not have. */
    missingSegment: string | null;
  }

  let { data, missingSegment }: Props = $props();

  const mode = $derived(data.mode);
  const versionMode = $derived(mode.kind === 'version' ? mode : null);
  const paragraphs = $derived(
    (data.edition.preface ?? '')
      .split(/\n\s*\n/u)
      .map((p) => p.trim())
      .filter((p) => p !== ''),
  );

  let preface = $state<HTMLDetailsElement | null>(null);
  let worksCited = $state<HTMLDetailsElement | null>(null);
  let citedWasOpen = false;
  let wasOpen = false;
</script>

<svelte:window
  onbeforeprint={() => {
    wasOpen = preface?.open ?? false;
    citedWasOpen = worksCited?.open ?? false;
    if (preface) preface.open = true;
    if (worksCited) worksCited.open = true;
  }}
  onafterprint={() => {
    if (preface) preface.open = wasOpen;
    if (worksCited) worksCited.open = citedWasOpen;
  }}
/>

{#if mode.kind !== 'published' || missingSegment}
  <div class="notices">
    {#if mode.kind === 'draft'}
      <Notice kind="warning" title={r.notices.draftTitle}>{r.notices.draftText}</Notice>
    {:else if mode.kind === 'preview'}
      <Notice kind="info" title={r.notices.previewTitle}>
        {r.notices.previewText}
        {#if mode.publishedNumber !== null}{r.notices.previewReaders(mode.publishedNumber)}{/if}
        <a href={data.links.current} class="text-accent underline">{r.notices.showPublished}</a>
      </Notice>
    {:else if versionMode}
      <Notice kind="info">
        <span class="font-medium text-ink">{r.notices.versionTitle(versionMode.number)} <LocalDate date={versionMode.at} /></span>.
        {versionMode.isCurrent ? r.notices.versionIsCurrent : r.notices.versionText}
        <a href={data.links.current} class="text-accent underline">{r.notices.readCurrent}</a>
      </Notice>
    {/if}
    {#if missingSegment}
      <Notice kind="warning">{r.notices.segmentMissing(missingSegment)}</Notice>
    {/if}
  </div>
{/if}

<header class="title-block">
  <p class="font-sans text-xs font-medium tracking-[0.12em] text-ink-muted uppercase">{r.authorAndWork(data.work.author, data.work.title)}</p>
  <h1 class="mt-2 font-serif text-title text-ink">{data.edition.title}</h1>
  {#if data.edition.editors.length}<p class="mt-1.5 font-serif text-lg text-ink-soft italic">{r.editedBy(and(data.edition.editors))}</p>{/if}
  <p class="mt-3 font-sans text-xs text-ink-muted">
    {#if mode.kind === 'published' && mode.number !== null && mode.at}
      {r.version(mode.number)}, {r.published} <LocalDate date={mode.at} />
    {:else if versionMode}
      {r.version(versionMode.number)}, {r.published} <LocalDate date={versionMode.at} />
    {:else if mode.kind === 'draft'}
      {r.draftVersion(mode.version)}
    {:else if mode.kind === 'preview'}
      {r.previewVersion(mode.version)}
    {:else}
      {r.unnumbered}
    {/if}
  </p>
</header>

{#if paragraphs.length}
  <details class="preface" bind:this={preface}>
    <summary class="cursor-pointer font-sans text-sm text-ink-soft select-none hover:text-ink">{r.text.preface}</summary>
    <div class="preface-text">
      {#each paragraphs as paragraph, k (k)}<p>{paragraph}</p>{/each}
    </div>
  </details>
{/if}

{#if data.worksCited.length}
  <details class="preface works-cited" bind:this={worksCited}>
    <summary class="cursor-pointer font-sans text-sm text-ink-soft select-none hover:text-ink">{r.text.worksCited}</summary>
    <ul class="preface-text">
      {#each data.worksCited as item (item.id)}
        <li id="bib-{item.key}"><span class="font-sans text-sm font-semibold text-ink">{item.label}</span> {item.reference}</li>
      {/each}
    </ul>
  </details>
{/if}

<style>
  .notices {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 2rem;
  }

  .title-block {
    margin-bottom: 2.25rem;
  }

  .preface {
    margin-bottom: 2.5rem;
    border-block: 1px solid var(--color-line);
    padding-block: 0.75rem;
  }

  .preface-text {
    margin-top: 0.75rem;
    font-family: var(--font-serif);
    font-size: var(--reader-size);
    line-height: 1.6;
    color: var(--color-ink);
  }

  .preface-text p + p {
    margin-top: 0.8em;
    text-indent: 1.5em;
  }

  @media print {
    .notices,
    .preface summary {
      display: none;
    }

    .title-block {
      margin-bottom: 1.5rem;
    }

    .preface {
      margin-bottom: 1.5rem;
      border: 0;
      padding: 0;
    }

    /* Printed open even where no script opened it before printing. */
    .preface::details-content {
      content-visibility: visible;
      display: block;
    }

    .preface-text {
      margin-top: 0;
      font-size: 11pt;
      line-height: 1.45;
    }
  }
</style>
