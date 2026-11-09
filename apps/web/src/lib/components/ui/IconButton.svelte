<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    /** The accessible name; also the tooltip the browser shows. */
    label: string;
    variant?: 'ghost' | 'secondary';
    size?: 'sm' | 'md';
    children: Snippet;
  }

  let {
    label,
    variant = 'ghost',
    size = 'md',
    type = 'button',
    class: className,
    children,
    ...rest
  }: Props = $props();

  const sizes = { sm: 'size-7 [&_svg]:size-4', md: 'size-8 [&_svg]:size-4' };
  const variants = {
    ghost: 'text-ink-soft hover:bg-sunken hover:text-ink',
    secondary: 'border border-line bg-surface text-ink-soft hover:bg-sunken hover:text-ink',
  };
</script>

<button
  {...rest}
  {type}
  aria-label={label}
  title={label}
  class={[
    'inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50',
    sizes[size],
    variants[variant],
    className,
  ]}
>
  {@render children()}
</button>
