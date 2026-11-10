<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button, Field, Input, toasts } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import type { AccountActionResult } from './types';

  interface Props {
    result: AccountActionResult | null | undefined;
  }

  let { result }: Props = $props();
  let submitting = $state(false);

  const mine = $derived(result?.form === 'password' ? result : undefined);

  $effect(() => {
    if (mine?.ok) toasts.success(s.account.passwordChanged);
  });
</script>

<form
  method="post"
  action="?/password"
  class="flex flex-col gap-4"
  novalidate
  use:enhance={() => {
    submitting = true;
    return async ({ update }) => {
      submitting = false;
      await update();
    };
  }}
>
  <Field label={s.account.currentPassword} error={mine?.errors?.current}>
    {#snippet children(control)}
      <Input {...control} name="current" type="password" autocomplete="current-password" required />
    {/snippet}
  </Field>
  <Field label={s.account.newPassword} hint={s.auth.passwordHint} error={mine?.errors?.next}>
    {#snippet children(control)}
      <Input {...control} name="next" type="password" autocomplete="new-password" required />
    {/snippet}
  </Field>
  <Field label={s.account.confirmPassword} error={mine?.errors?.confirm}>
    {#snippet children(control)}
      <Input {...control} name="confirm" type="password" autocomplete="new-password" required />
    {/snippet}
  </Field>
  <div>
    <Button type="submit" variant="secondary" loading={submitting}
      >{s.account.changePassword}</Button
    >
  </div>
</form>
