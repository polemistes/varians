<script lang="ts">
  import type { Snippet } from 'svelte';
  import { DropdownMenu } from 'bits-ui';
  import { buttonClasses, type ButtonSize, type ButtonVariant } from './Button.svelte';

  interface Props {
    open?: boolean;
    /** The content of the trigger button. */
    trigger: Snippet;
    /** The items: MenuItem, MenuSeparator, MenuLabel. */
    children: Snippet;
    /** Accessible name of the trigger when its content is not text. */
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
    triggerVariant = 'ghost',
    triggerSize = 'md',
    triggerClass,
    align = 'end',
    side = 'bottom',
    class: className,
  }: Props = $props();
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger
    class={[
      buttonClasses(triggerVariant, triggerSize),
      'data-[state=open]:bg-sunken',
      triggerClass,
    ]}
    aria-label={label}
  >
    {@render trigger()}
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      {align}
      {side}
      sideOffset={6}
      class={[
        'z-50 min-w-44 rounded-md border border-line bg-surface p-1 font-sans text-sm shadow-pop outline-none animate-fade-in',
        className,
      ]}
    >
      {@render children()}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
