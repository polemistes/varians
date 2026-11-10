<script lang="ts">
  import { PageFrame } from '$lib/components/shell';
  import { Notice } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<PageFrame title={data.confirmed ? s.auth.confirmedTitle : s.auth.confirmTitle} width="narrow">
  {#if data.confirmed}
    <Notice kind="success">{s.auth.confirmed}</Notice>
  {:else}
    <Notice kind="error">{s.auth.confirmInvalid}</Notice>
  {/if}
  {#if !data.signedIn}
    <p class="mt-6 font-sans text-sm">
      <a href="/login" class="text-accent underline">{s.auth.logInTitle}</a>
    </p>
  {/if}
</PageFrame>
