<script lang="ts">
  /** A version of an edition in the reader. */
  import Reader from '$lib/components/reader/Reader.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<Reader {data} />
