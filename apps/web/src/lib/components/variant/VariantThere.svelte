<script lang="ts">
  /**
   * The witnesses that are there at a variant ("In 7 of 9 witnesses: …", "In
   * all 9 witnesses"), and those in which its words are an addition: up to two
   * paragraphs, which the parent lays out, in a column in the reader's window
   * and in a line in the edition editor's band.
   */
  import { reader as r } from '$lib/strings/reader';
  import type { Variant } from '$lib/reader/variant';
  import Sigla from './Sigla.svelte';

  interface Props {
    variant: Pick<Variant, 'there' | 'addition'>;
    /** A siglum was activated: the siglum of the conspectus. */
    onwitness?: (siglum: string) => void;
  }

  let { variant, onwitness }: Props = $props();
</script>

{#if variant.there}
  <p class="there">
    {#if variant.there.all}
      {r.variant.thereAll(variant.there.total)}
    {:else}
      {r.variant.thereSome(variant.there.count, variant.there.total)}:
      <span class="chips"><Sigla chips={variant.there.chips} {onwitness} /></span>
    {/if}
  </p>
{/if}
{#if variant.addition}
  <p class="addition">
    {r.variant.addition}
    <span class="chips"><Sigla chips={variant.addition} {onwitness} /></span>
  </p>
{/if}

<style>
  .there,
  .addition {
    color: var(--color-ink);
  }
</style>
