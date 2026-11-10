<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button, Field, Input, toasts } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import type { AccountActionResult } from './types';

  interface Props {
    orcid: string | null;
    result: AccountActionResult | null | undefined;
  }

  let { orcid, result }: Props = $props();
  let submitting = $state(false);

  const mine = $derived(result?.form === 'orcid' ? result : undefined);

  $effect(() => {
    if (!mine?.ok) return;
    if (mine.claimed) toasts.success(s.account.orcidClaimed(mine.claimed));
    else toasts.success(mine.cleared ? s.account.orcidCleared : s.account.orcidSaved);
  });
</script>

<form
  method="post"
  action="?/orcid"
  class="flex flex-col gap-4"
  novalidate
  use:enhance={() => {
    submitting = true;
    return async ({ update }) => {
      submitting = false;
      await update({ reset: false });
    };
  }}
>
  <Field label={s.account.orcid} error={mine?.errors?.orcid}>
    {#snippet children(control)}
      <Input
        {...control}
        name="orcid"
        inputmode="text"
        spellcheck="false"
        placeholder="0000-0000-0000-0000"
        value={mine?.values?.orcid ?? orcid ?? ''}
      />
    {/snippet}
  </Field>
  <div>
    <Button type="submit" variant="primary" loading={submitting}>{s.account.save}</Button>
  </div>
</form>
