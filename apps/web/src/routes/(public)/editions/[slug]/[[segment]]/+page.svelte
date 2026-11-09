<script lang="ts">
  import Reader from '$lib/components/reader/Reader.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<Reader {data} />
