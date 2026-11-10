<script lang="ts">
  /**
   * Witnesses by their sigla, in the order given: a group's siglum with its
   * members beside it in brackets, a witness known only from a report with
   * the word and its source after it. A siglum is a button whose name and
   * title are the witness's name; it opens the witness.
   */
  import { reader as r } from '$lib/strings/reader';
  import type { Chip, WitnessChip } from '$lib/reader/variant';

  interface Props {
    chips: Chip[];
    onwitness?: (siglum: string) => void;
  }

  let { chips, onwitness }: Props = $props();
</script>

{#snippet witness(chip: WitnessChip)}
  <span class="chip"
    >{#if chip.witness !== null}<button
        type="button"
        class="siglum"
        title={chip.name}
        aria-label={chip.name}
        onclick={(event) => {
          // The card or row it stands in answers a click of its own.
          event.stopPropagation();
          onwitness?.(chip.witness!);
        }}>{chip.siglum}</button
      >{:else}<span class="siglum unlisted" title={chip.name}>{chip.siglum}</span
      >{/if}{#if chip.reported}{' '}<span class="reported"
        >{r.variant.reported(chip.reported.source)}</span
      >{/if}</span
  >
{/snippet}

{#each chips as chip, k (k)}
  {#if k > 0}{' '}{/if}
  {#if chip.kind === 'group'}
    <span class="group"
      ><span class="group-siglum" title={chip.note ?? undefined}>{chip.siglum}</span>
      <span class="members"
        >(<span class="member-list"
          >{#each chip.members as member, n (member.siglum)}{#if n > 0}{' '}{/if}{@render witness(
              member,
            )}{/each}</span
        >)</span
      ></span
    >
  {:else}
    {@render witness(chip)}
  {/if}
{/each}

<style>
  .siglum {
    display: inline-block;
    min-width: 1.45em;
    border: 1px solid var(--color-line);
    border-radius: 0.25rem;
    padding: 0 0.3em;
    font-family: var(--font-sans);
    font-size: 0.8em;
    font-weight: 500;
    line-height: 1.5;
    text-align: center;
    color: var(--color-ink);
  }

  button.siglum {
    cursor: pointer;
  }

  button.siglum:hover {
    border-color: var(--color-line-strong);
    background: var(--color-sunken);
  }

  button.siglum:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }

  .unlisted {
    color: var(--color-ink-muted);
  }

  .group {
    display: inline-block;
    white-space: nowrap;
  }

  .group-siglum {
    font-weight: 500;
    color: var(--color-ink);
  }

  .members {
    color: var(--color-ink-muted);
  }

  .reported {
    font-size: 0.85em;
    color: var(--color-ink-muted);
  }
</style>
