<script lang="ts" module>
  /** Shared by Input, Textarea and Select. */
  export const controlClasses =
    'w-full rounded-md border border-line bg-surface font-sans text-sm text-ink placeholder:text-ink-muted transition-colors duration-100 focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:focus:ring-danger/20';
</script>

<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends HTMLInputAttributes {
    value?: string | number | null;
    /** Marks the control invalid; Field passes aria-invalid instead. */
    invalid?: boolean;
  }

  let {
    value = $bindable(),
    invalid = false,
    class: className,
    type = 'text',
    ...rest
  }: Props = $props();
</script>

<input
  {...rest}
  {type}
  bind:value
  class={[controlClasses, 'h-9 px-3', className]}
  aria-invalid={invalid ? 'true' : rest['aria-invalid']}
/>
