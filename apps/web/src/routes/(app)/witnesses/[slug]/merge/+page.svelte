<script lang="ts">
  import { MergePanel } from '$lib/components/registry';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<MergePanel {data} error={form && 'error' in form ? String(form.error) : null} />
