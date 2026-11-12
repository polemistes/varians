<script lang="ts">
  /**
   * What a record is in a list or a header: Version n, its latest version
   * that is not withdrawn, or Draft while none stands. One badge for every
   * kind and every place.
   */
  import { Badge } from '$lib/components/ui';
  import { versions as v } from '$lib/strings/versions';

  interface Props {
    latestVersion: number | null;
    class?: string;
  }

  let { latestVersion, class: className }: Props = $props();
</script>

{#if latestVersion === null}
  <Badge class={className}>{v.draft}</Badge>
{:else}
  <Badge tone="success" class={className}>{v.version(latestVersion)}</Badge>
{/if}
