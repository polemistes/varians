<script lang="ts">
  /**
   * The line under a page image (PLAN-2 D5): the credit line the rights
   * holder asks for, and the image's rights statement by its label, linked to
   * its address. Nothing when the image has neither.
   */
  import { rightsStatement } from '@varians/core';

  interface Props {
    rights?: string | null;
    attribution?: string | null;
    class?: string;
  }

  let { rights = null, attribution = null, class: className }: Props = $props();

  const statement = $derived(rightsStatement(rights));
</script>

{#if statement || attribution}
  <p class={['font-sans text-xs text-ink-soft', className]} data-image-credit>
    {#if attribution}<span>{attribution}</span>{/if}{#if attribution && statement}{' '}<span aria-hidden="true">·</span>{' '}{/if}{#if statement}<a
        href={statement.uri}
        rel="license noopener"
        target="_blank"
        class="underline decoration-line-strong underline-offset-2 hover:text-ink">{statement.label}</a
      >{/if}
  </p>
{/if}
