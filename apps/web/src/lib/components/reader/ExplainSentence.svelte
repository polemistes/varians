<script lang="ts">
  /**
   * One sentence of a variant's explanation, inline: plain words in the
   * interface face, a witness by name with its siglum quietly beside it, the
   * words of the text in the text's serif.
   */
  import type { Sentence } from '$lib/reader/explain';
  import { reader as r } from '$lib/strings/reader';

  interface Props {
    sentence: Sentence;
    /** The language of the text, for the quoted words. */
    lang: string;
  }

  let { sentence, lang }: Props = $props();
</script>

{#each sentence as part, k (k)}{#if part.kind === 'text'}{part.text}{:else if part.kind === 'witness'}<span
      class="witness"
      >{part.name}{#if part.siglum}<span class="siglum"
          ><span class="sr-only">{r.explain.siglumOpen}</span>{part.siglum}<span class="sr-only"
            >{r.explain.siglumClose}</span
          ></span
        >{/if}</span
    >{:else}<span class="words" {lang} dir="auto">{part.text}</span>{/if}{/each}

<style>
  .witness {
    color: var(--color-ink);
  }

  .siglum {
    display: inline-block;
    margin-inline-start: 0.3em;
    min-width: 1.3em;
    border: 1px solid var(--color-line);
    border-radius: 0.25rem;
    padding: 0 0.3em;
    font-family: var(--font-sans);
    font-size: 0.72em;
    font-weight: 500;
    line-height: 1.45;
    text-align: center;
    vertical-align: 0.1em;
    color: var(--color-ink-muted);
  }

  .words {
    font-family: var(--font-serif);
    font-size: 1.14em;
    line-height: 1;
    color: var(--color-ink);
  }
</style>
