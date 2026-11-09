<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Popover } from 'bits-ui';
  import { buttonClasses, type ButtonSize, type ButtonVariant } from './Button.svelte';

  interface Props {
    open?: boolean;
    /** The content of the trigger button. */
    trigger: Snippet;
    children: Snippet;
    label?: string;
    triggerVariant?: ButtonVariant;
    triggerSize?: ButtonSize;
    triggerClass?: string;
    align?: 'start' | 'center' | 'end';
    side?: 'top' | 'right' | 'bottom' | 'left';
    class?: string;
  }

  let {
    open = $bindable(false),
    trigger,
    children,
    label,
    triggerVariant = 'secondary',
    triggerSize = 'md',
    triggerClass,
    align = 'start',
    side = 'bottom',
    class: className,
  }: Props = $props();
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    class={[buttonClasses(triggerVariant, triggerSize), 'data-[state=open]:bg-sunken', triggerClass]}
    aria-label={label}
  >
    {@render trigger()}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      {align}
      {side}
      sideOffset={6}
      class={[
        'z-50 w-72 rounded-md border border-line bg-surface p-4 font-sans text-sm text-ink shadow-pop outline-none animate-fade-in',
        className,
      ]}
    >
      {@render children()}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
