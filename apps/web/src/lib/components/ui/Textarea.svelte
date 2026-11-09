<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements';
  import { controlClasses } from './Input.svelte';

  interface Props extends HTMLTextareaAttributes {
    value?: string | null;
    invalid?: boolean;
    /** Serif, for text that is itself the object of study. */
    serif?: boolean;
  }

  let { value = $bindable(), invalid = false, serif = false, rows = 4, class: className, ...rest }: Props = $props();
</script>

<textarea
  {...rest}
  {rows}
  bind:value
  class={[controlClasses, 'min-h-9 px-3 py-2 leading-relaxed', serif && 'font-serif text-reading', className]}
  aria-invalid={invalid ? 'true' : rest['aria-invalid']}
></textarea>
