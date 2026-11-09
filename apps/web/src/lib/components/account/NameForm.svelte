<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button, Field, Input, toasts } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import type { AccountActionResult } from './types';

  interface Props {
    name: string;
    result: AccountActionResult | null | undefined;
  }

  let { name, result }: Props = $props();
  let submitting = $state(false);

  const mine = $derived(result?.form === 'name' ? result : undefined);

  $effect(() => {
    if (mine?.ok) toasts.success(s.account.nameSaved);
  });
</script>

<form
  method="post"
  action="?/name"
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
  <Field label={s.auth.name} error={mine?.errors?.name}>
    {#snippet children(control)}
      <Input {...control} name="name" autocomplete="name" required value={mine?.values?.name ?? name} />
    {/snippet}
  </Field>
  <div>
    <Button type="submit" variant="primary" loading={submitting}>{s.account.save}</Button>
  </div>
</form>
