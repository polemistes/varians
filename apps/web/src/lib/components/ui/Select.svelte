<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLSelectAttributes } from 'svelte/elements';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { controlClasses } from './Input.svelte';

  export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
  }

  interface Props extends HTMLSelectAttributes {
    value?: string;
    /** Either pass options, or render <option> elements as children. */
    options?: SelectOption[];
    invalid?: boolean;
    children?: Snippet;
  }

  let { value = $bindable(), options, invalid = false, class: className, children, ...rest }: Props = $props();
</script>

<div class={['relative', className]}>
  <select
    {...rest}
    bind:value
    class={[controlClasses, 'h-9 appearance-none pr-9 pl-3']}
    aria-invalid={invalid ? 'true' : rest['aria-invalid']}
  >
    {#if options}
      {#each options as option (option.value)}
        <option value={option.value} disabled={option.disabled}>{option.label}</option>
      {/each}
    {/if}
    {@render children?.()}
  </select>
  <ChevronDown class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
</div>
