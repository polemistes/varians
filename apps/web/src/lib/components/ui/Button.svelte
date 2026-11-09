<script lang="ts" module>
  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
  export type ButtonSize = 'sm' | 'md';

  const base =
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-sans font-medium whitespace-nowrap select-none transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50';

  const sizes: Record<ButtonSize, string> = {
    sm: 'h-8 px-2.5 text-sm',
    md: 'h-9 px-3.5 text-sm',
  };

  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-accent-ink hover:bg-accent-hover',
    secondary: 'border border-line bg-surface text-ink hover:bg-sunken hover:border-line-strong',
    ghost: 'text-ink hover:bg-sunken',
    danger: 'border border-line text-danger hover:border-danger/40 hover:bg-danger-soft',
  };

  /** The classes of a button, for elements that must look like one (menu triggers). */
  export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md'): string {
    return `${base} ${sizes[size]} ${variants[variant]}`;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
  import Spinner from './Spinner.svelte';

  interface Props extends HTMLButtonAttributes {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Shows a spinner and blocks input while a request runs. */
    loading?: boolean;
    /** Renders a link that looks like a button. */
    href?: string;
    children?: Snippet;
  }

  let {
    variant = 'secondary',
    size = 'md',
    loading = false,
    href,
    disabled = false,
    type = 'button',
    class: className,
    children,
    ...rest
  }: Props = $props();

  const classes = $derived([buttonClasses(variant, size), className]);
  const blocked = $derived(Boolean(disabled) || loading);
</script>

{#if href}
  <a
    {...rest as HTMLAnchorAttributes}
    href={blocked ? undefined : href}
    class={classes}
    aria-disabled={blocked || undefined}
    aria-busy={loading || undefined}
    tabindex={blocked ? -1 : undefined}
  >
    {#if loading}<Spinner size="sm" />{/if}
    {@render children?.()}
  </a>
{:else}
  <button {...rest} {type} class={classes} disabled={blocked} aria-busy={loading || undefined}>
    {#if loading}<Spinner size="sm" />{/if}
    {@render children?.()}
  </button>
{/if}
