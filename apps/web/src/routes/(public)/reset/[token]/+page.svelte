<script lang="ts">
  import AuthForm from '$lib/components/auth/AuthForm.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { Field, Input, Notice } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const invalid = $derived(!data.valid || (form && 'invalid' in form));
</script>

<PageFrame title={s.auth.resetTitle} width="narrow">
  {#if invalid}
    <Notice kind="error">{s.auth.resetInvalid}</Notice>
    {#if data.mail}
      <p class="mt-6 font-sans text-sm"><a href="/reset" class="text-accent underline">{s.auth.resetAgain}</a></p>
    {/if}
  {:else}
    <AuthForm formError={form?.errors?.form} submitLabel={s.auth.setPassword}>
      <Field label={s.auth.newPassword} hint={s.auth.passwordHint} error={form?.errors?.password}>
        {#snippet children(control)}
          <Input {...control} name="password" type="password" autocomplete="new-password" required />
        {/snippet}
      </Field>
      <Field label={s.auth.repeatPassword} error={form?.errors?.repeat}>
        {#snippet children(control)}
          <Input {...control} name="repeat" type="password" autocomplete="new-password" required />
        {/snippet}
      </Field>
    </AuthForm>
  {/if}
</PageFrame>
