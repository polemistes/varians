<script lang="ts">
  /**
   * The edition's words at a variant, in the text's serif; where the edition
   * has none (witnesses have words at a point between two words), the word
   * the point follows or precedes; for whole lines, the line they follow or
   * the labels of the lines; and the kinds the editor gave the variant, where
   * they are not the common one (unless the page shows them as controls).
   */
  import { reader as r } from '$lib/strings/reader';
  import type { Variant } from '$lib/reader/variant';

  interface Props {
    variant: Pick<Variant, 'words' | 'place' | 'lines' | 'minor' | 'interpretative'>;
    lang: string;
    class?: string;
    /** Say the kinds the variant has; a page that sets them shows them itself. */
    kinds?: boolean;
  }

  let { variant, lang, class: className, kinds = true }: Props = $props();
</script>

{#if variant.words}
  <span class={['words', className]} {lang} dir="auto">{variant.words}</span>
{:else if variant.lines}
  <span class={['where', className]}
    >{#if variant.lines.after}{r.variant.after}
      <span class="line-label">{variant.lines.after}</span>{:else}<span class="line-label"
        >{variant.lines.labels}</span
      >{/if}</span
  >
{:else if variant.place}
  <span class={['where', className]}
    >{variant.place.side === 'after' ? r.variant.after : r.variant.before}
    <span class="place-word" {lang} dir="auto">{variant.place.word}</span></span
  >
{/if}{#if kinds && (variant.interpretative || variant.minor)}<span class="kinds"
    >{#if variant.interpretative}<span class="kind">{r.variant.interpretative}</span
      >{/if}{#if variant.minor}<span class="kind">{r.variant.minor}</span>{/if}</span
  >{/if}

<style>
  .words {
    font-family: var(--font-serif);
    color: var(--color-ink);
  }

  .where {
    font-family: var(--font-sans);
    font-size: 0.8em;
    color: var(--color-ink-muted);
  }

  .line-label {
    font-variant-numeric: tabular-nums;
    font-size: 1.1em;
    color: var(--color-ink);
  }

  .place-word {
    font-family: var(--font-serif);
    font-size: 1.25em;
    color: var(--color-ink);
  }

  .kinds {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-inline-start: 0.6rem;
    vertical-align: middle;
  }

  .kind {
    border: 1px solid var(--color-line);
    border-radius: 0.25rem;
    padding: 0 0.35rem;
    font-family: var(--font-sans);
    font-size: 0.7rem;
    line-height: 1.4;
    letter-spacing: 0.02em;
    color: var(--color-ink-soft);
  }
</style>
