<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLInputAttributes, 'type'> {
    checked?: boolean;
    /** The label text. */
    children?: Snippet;
    /** A second line under the label. */
    hint?: string;
  }

  let { checked = $bindable(false), hint, class: className, children, ...rest }: Props = $props();
</script>

<label
  class={[
    'inline-flex cursor-pointer items-start gap-2.5 font-sans text-sm text-ink has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50',
    className,
  ]}
>
  <input
    {...rest}
    type="checkbox"
    bind:checked
    class="mt-0.5 size-4 shrink-0 rounded border-line"
  />
  <span class="flex flex-col">
    <span>{@render children?.()}</span>
    {#if hint}<span class="text-xs text-ink-soft">{hint}</span>{/if}
  </span>
</label>
