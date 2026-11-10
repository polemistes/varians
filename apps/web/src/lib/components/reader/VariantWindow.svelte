<script lang="ts">
  /**
   * A variant as a list: the witnesses that are there, the witnesses in which
   * the words are an addition, one row for each reading with the sigla of the
   * witnesses that have it (the edition's reading first), and the editor's
   * notes. The popover on a word or a point and the list of variants both
   * show it, from the same structure, the list in a compact form.
   */
  import type { Variant } from '$lib/reader/variant';
  import VariantRows from '../variant/VariantRows.svelte';
  import VariantThere from '../variant/VariantThere.svelte';
  import ReaderNotes from './ReaderNotes.svelte';

  interface Props {
    variant: Variant;
    /** The language of the text, for the quoted words. */
    lang: string;
    /** Smaller type, for the list of variants. */
    compact?: boolean;
    /** A siglum was activated: the siglum of the conspectus, and the key of the variant. */
    onwitness?: (siglum: string, key: string) => void;
    /** A row's link to the variant where its witnesses have the words in another place. */
    onopen?: (key: string, from: HTMLElement) => void;
  }

  let { variant, lang, compact = false, onwitness, onopen }: Props = $props();

  const open = (siglum: string) => onwitness?.(siglum, variant.key);
</script>

<div class={['window', compact && 'compact']}>
  <VariantThere {variant} onwitness={open} />

  <VariantRows rows={variant.rows} {lang} onwitness={open} {onopen} />

  {#if variant.notes.length}
    <ReaderNotes notes={variant.notes} {compact} />
  {/if}
</div>

<style>
  .window {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-family: var(--font-sans);
    font-size: 0.875rem;
    line-height: 1.55;
    color: var(--color-ink-soft);
  }

  .compact {
    gap: 0.4rem;
    font-size: 0.8125rem;
  }
</style>
