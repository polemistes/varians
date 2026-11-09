<script lang="ts">
  /** A bibliography reference with its titles in italics. */
  import type { Piece } from '$lib/bibliography/format';

  interface Props {
    pieces: Piece[];
    class?: string;
  }

  let { pieces, class: className }: Props = $props();
</script>

<span class={['font-serif', className]}>{#each pieces as piece, i (i)}{#if piece.italic}<i>{piece.text}</i>{:else}{piece.text}{/if}{/each}</span>
