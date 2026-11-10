<script lang="ts">
  /**
   * The rows of a variant: for each reading its words, then the sigla of the
   * witnesses that have it and what the reading rests on besides them (the
   * proposer of a conjecture, the editor), its references, and a link to the
   * variant where the same witnesses have the words in another place. The
   * edition's reading is set apart by its weight alone, and read out as the
   * edition's by screen readers. Where the page can act on a row (the edition
   * editor adopts it), the row's reading is the button.
   */
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import { reader as r } from '$lib/strings/reader';
  import { whereText, type Row, type RowOrigin } from '$lib/reader/variant';
  import Sigla from './Sigla.svelte';

  interface Props {
    rows: Row[];
    /** The language of the text, for the quoted words. */
    lang: string;
    /** A siglum was activated: the siglum of the conspectus. */
    onwitness?: (siglum: string) => void;
    /** A row's link was activated: the variant it names. */
    onopen?: (key: string, from: HTMLElement) => void;
    /** A row's reading was activated, for a row that has an origin: the reading is then a button. */
    onadopt?: (origin: RowOrigin) => void;
    /** The title of that button. */
    adoptTitle?: string;
    /** Said beside the conjecture the edition prints, where the page marks it. */
    adoptedLabel?: string;
  }

  let { rows, lang, onwitness, onopen, onadopt, adoptTitle, adoptedLabel }: Props = $props();
</script>

{#snippet said(row: Row)}
  {#if row.lead}<span class="lead">{r.variant[row.lead]}</span>{/if}
  {#if row.words}{' '}<span class="words" {lang} dir="auto">{row.words}</span>{/if}
{/snippet}

<ul class="rows">
  {#each rows as row, k (k)}
    <li class={['row', row.kind]}>
      <span class="reading">
        {#if row.kind === 'edition'}<span class="sr-only">{r.variant.edition}: </span>{/if}
        {#if onadopt && row.origin}
          <button
            type="button"
            class="take"
            title={adoptTitle}
            onclick={(event) => {
              event.stopPropagation();
              onadopt(row.origin!);
            }}>{@render said(row)}</button
          >
        {:else}
          {@render said(row)}
        {/if}
      </span>
      <span class="who">
        {#if row.chips.length}<span class="chips"><Sigla chips={row.chips} {onwitness} /></span
          >{/if}
        {#each row.rests as rest, n (n)}
          <span class="rest"
            >{#if rest.kind === 'editor'}{row.lead === 'notIn'
                ? r.variant.theEdition
                : r.variant.theEditor}{:else}{rest.name}, {r.variant[rest.what]}{/if}</span
          >{#if adoptedLabel && row.kind === 'edition' && rest.kind === 'conjecture'}<span
              class="adopted">{adoptedLabel}</span
            >{/if}
        {/each}
        {#if row.references.length}
          <span class="refs">{row.references.join('; ')}</span>
        {/if}
        {#each row.links as link (link.key)}
          <button
            type="button"
            class="link"
            aria-label={r.variant.open(whereText(link.where))}
            title={r.variant.open(whereText(link.where))}
            onclick={(event) => {
              event.stopPropagation();
              onopen?.(link.key, event.currentTarget);
            }}
          >
            <ArrowRight class="size-3" aria-hidden="true" />
            {#if link.where.words}<span class="words" {lang} dir="auto">{link.where.words}</span
              >{:else if link.where.place}{link.where.place.side === 'after'
                ? r.variant.after
                : r.variant.before}
              <span class="words" {lang} dir="auto">{link.where.place.word}</span>{/if}
          </button>
        {/each}
      </span>
    </li>
  {/each}
</ul>

<style>
  /* One row for each reading: the words, then the sigla, in columns the rows share. */
  .rows {
    display: grid;
    grid-template-columns: fit-content(45%) minmax(0, 1fr);
    column-gap: 0.9rem;
    row-gap: 0.3rem;
  }

  .row {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
    align-items: baseline;
  }

  .reading {
    min-width: 0;
    color: var(--color-ink);
    overflow-wrap: anywhere;
  }

  .words {
    font-family: var(--font-serif);
    font-size: 1.14em;
    line-height: 1.2;
    color: var(--color-ink);
  }

  .lead {
    color: var(--color-ink-soft);
  }

  /* The edition's reading is set apart by its weight alone. */
  .edition .reading,
  .edition .words,
  .edition .lead {
    font-weight: 700;
    color: var(--color-ink);
  }

  .who {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 0.45rem;
    row-gap: 0.15rem;
  }

  .rest {
    color: var(--color-ink);
  }

  .adopted {
    border-radius: 0.2rem;
    padding: 0 0.3em;
    font-size: 0.85em;
    background: var(--color-success-soft);
    color: var(--color-ink-muted);
  }

  /* A reading that can be taken: the words themselves, with the weight and the colour of the row. */
  .take {
    display: inline;
    border-radius: 0.2rem;
    padding: 0;
    text-align: start;
    font: inherit;
    color: inherit;
  }

  .take:hover {
    background: var(--color-sunken);
  }

  .take:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }

  .refs {
    font-size: 0.85em;
    color: var(--color-ink-muted);
  }

  .link {
    display: inline-flex;
    align-items: baseline;
    gap: 0.25em;
    border-radius: 0.2rem;
    font-size: 0.9em;
    color: var(--color-accent);
  }

  .link:hover {
    text-decoration: underline;
  }

  .link:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }

  .link :global(svg) {
    align-self: center;
  }
</style>
