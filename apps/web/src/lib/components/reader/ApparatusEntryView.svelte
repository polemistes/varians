<script lang="ts">
  /**
   * One apparatus entry, from the structured entry the core renders: the
   * label in bold, the lemma in the text's serif, sigla in small sans
   * capitals, readings separated by a colon, words such as om. in italics,
   * the names of proposers as names. The order of the parts is that of
   * formatEntry, so the page reads as the plain text does.
   */
  import type { ApparatusConventions, ApparatusEntry, ApparatusVariant } from '@varians/core';
  import { reader as r } from '$lib/strings/reader';

  interface Props {
    entry: ApparatusEntry;
    conventions: ApparatusConventions;
    /** The site's key, for lighting the entry and its words together. */
    siteKey: string;
    /** Inline entries run on like a printed apparatus; stacked entries stand one per line. */
    layout?: 'inline' | 'stacked';
    showLabel?: boolean;
  }

  let { entry, conventions, siteKey, layout = 'inline', showLabel = true }: Props = $props();

  /** A conjecture with words prints its kind after the name, in brackets: "δαῖτα Zenodotus (coni.)". */
  function conjectureWithText(variant: ApparatusVariant): boolean {
    return variant.attachment?.kind === 'conjecture' && variant.attachment.conjectureKind !== 'deletion' && variant.text !== '';
  }

  const lemmaSource = $derived(entry.adopted ? null : conventions.form === 'positive' ? entry.lemmaSigla : []);
  /** Whether anything stands before the readings; an addition with nothing to name opens with its reading. */
  const head = $derived(entry.lemma !== '' || Boolean(entry.adopted) || (lemmaSource?.length ?? 0) > 0);
</script>

<span class={['entry', layout === 'stacked' && 'entry-stacked']} data-site={siteKey} dir="auto">
  {#if showLabel}<b class="entry-label">{entry.label}</b>{'\u00a0'}{/if}{#if entry.lemma}<span class="lemma">{entry.lemma}</span>{/if}{#if entry.adopted}{' '}<span class="name">{entry.adopted.name}</span>{#if entry.adopted.source}{' '}<span class="source">{entry.adopted.source}</span>{/if}{:else if lemmaSource && lemmaSource.length}{' '}<span class="sigla">{lemmaSource.join(' ')}</span>{/if}{#each entry.variants as variant, k (k)}{#if k > 0 || head}<span class="colon">{' '}:{' '}</span>{/if}<span class="variant">{#if conjectureWithText(variant)}<span class="reading">{variant.text}</span>{' '}<span class="name">{variant.attachment!.name}</span>{#if variant.attachment!.source}{' '}<span class="source">{variant.attachment!.source}</span>{/if}{#if variant.note}{' '}<i class="note">({variant.note})</i>{/if}{:else}{#if variant.text}<span class="reading">{variant.text}</span>{/if}{#if variant.note}{#if variant.text}{' '}{/if}<i class="note">{variant.note}</i>{/if}{' '}{#if variant.attachment}<span class="name">{variant.attachment.name}</span>{#if variant.attachment.source}{' '}<span class="source">{variant.attachment.source}</span>{/if}{:else}<span class="sigla">{variant.sigla.join(' ')}</span>{/if}{/if}</span>{/each}{#if entry.transposition}{' '}<i class="note">{entry.transposition}</i>{/if}
</span>

<style>
  .entry {
    border-radius: 0.2rem;
    transition: background-color 120ms ease-out;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }

  .entry-stacked {
    display: block;
    padding-block: 0.1rem;
  }

  .entry:global([data-lit]),
  .entry:global([data-active]) {
    background-color: var(--color-accent-soft);
  }

  .entry-label {
    font-family: var(--font-sans);
    font-weight: 600;
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
    color: var(--color-ink);
  }

  .lemma,
  .reading {
    font-family: var(--font-serif);
    font-size: 1.08em;
    color: var(--color-ink);
  }

  .sigla {
    font-family: var(--font-sans);
    font-size: 1.02em;
    font-variant-caps: all-small-caps;
    letter-spacing: 0.05em;
    color: var(--color-ink-soft);
  }

  .name {
    color: var(--color-ink-soft);
  }

  .source {
    color: var(--color-ink-muted);
  }

  .note {
    color: var(--color-ink-soft);
  }

  .colon {
    color: var(--color-ink-muted);
  }


  @media print {
    .entry:global([data-lit]),
    .entry:global([data-active]) {
      background: none;
    }

    .sigla,
    .name,
    .source,
    .note,
    .colon {
      color: inherit;
    }
  }
</style>
