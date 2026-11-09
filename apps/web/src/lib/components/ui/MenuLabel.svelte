<script lang="ts">
  import type { Snippet } from 'svelte';
  import { DropdownMenu } from 'bits-ui';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

<DropdownMenu.Group>
  <DropdownMenu.GroupHeading class="px-2 py-1.5 text-xs text-ink-muted">{@render children()}</DropdownMenu.GroupHeading>
</DropdownMenu.Group>
