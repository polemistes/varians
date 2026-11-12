<script lang="ts">
  /** A version of a transcription, in the workbench read only. */
  import Workbench from '../../+page.svelte';
  import type { PageProps } from './$types';

  let { data, params }: PageProps = $props();
</script>

<Workbench {data} {params} form={null} />
