<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { Tooltip } from 'bits-ui';

  /** The attributes the tooltip needs on its trigger; spread them onto your element or component. */
  export type TriggerProps = HTMLAttributes<HTMLElement>;

  interface Props {
    text: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
    /** The element the tooltip explains, rendered with the trigger props. */
    children: Snippet<[TriggerProps]>;
  }

  let { text, side = 'top', children }: Props = $props();
</script>

<Tooltip.Provider delayDuration={400}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        {@render children(props as unknown as TriggerProps)}
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        {side}
        sideOffset={6}
        class="z-50 max-w-xs rounded bg-ink px-2 py-1 font-sans text-xs text-page shadow-pop animate-fade-in"
      >
        {text}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
