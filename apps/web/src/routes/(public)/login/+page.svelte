<script lang="ts">
  import AuthForm from '$lib/components/auth/AuthForm.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { Field, Input } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import type { PageProps } from './$types';

  let { form }: PageProps = $props();
</script>

<PageFrame title={s.auth.logInTitle} width="narrow">
  <AuthForm formError={form?.errors?.form} submitLabel={s.auth.logInAction}>
    <Field label={s.auth.email} error={form?.errors?.email}>
      {#snippet children(control)}
        <Input
          {...control}
          name="email"
          type="email"
          autocomplete="email"
          required
          value={form?.values?.email ?? ''}
        />
      {/snippet}
    </Field>
    <Field label={s.auth.password} error={form?.errors?.password}>
      {#snippet children(control)}
        <Input
          {...control}
          name="password"
          type="password"
          autocomplete="current-password"
          required
        />
      {/snippet}
    </Field>
    {#snippet aside()}
      {s.auth.noAccount}
      <a href="/register" class="text-accent underline">{s.auth.registerTitle}</a>
      <br />
      <a href="/reset" class="text-accent underline">{s.auth.forgotPassword}</a>
    {/snippet}
  </AuthForm>
</PageFrame>
