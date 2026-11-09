<script lang="ts">
  import AuthForm from '$lib/components/auth/AuthForm.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { Field, Input, Notice } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import type { PageProps } from './$types';

  let { form }: PageProps = $props();
</script>

{#if form?.confirm}
  <PageFrame title={s.auth.confirmTitle} width="narrow">
    <Notice kind={form.confirm.sent ? 'info' : 'error'}>
      {form.confirm.sent ? s.auth.confirmSent(form.confirm.email) : s.auth.confirmNotSent}
    </Notice>
  </PageFrame>
{:else}
<PageFrame title={s.auth.registerTitle} width="narrow">
  <AuthForm submitLabel={s.auth.registerAction}>
    <Field label={s.auth.name} error={form?.errors?.name}>
      {#snippet children(control)}
        <Input {...control} name="name" autocomplete="name" required value={form?.values?.name ?? ''} />
      {/snippet}
    </Field>
    <Field label={s.auth.email} error={form?.errors?.email}>
      {#snippet children(control)}
        <Input {...control} name="email" type="email" autocomplete="email" required value={form?.values?.email ?? ''} />
      {/snippet}
    </Field>
    <Field label={s.auth.password} hint={s.auth.passwordHint} error={form?.errors?.password}>
      {#snippet children(control)}
        <Input {...control} name="password" type="password" autocomplete="new-password" required />
      {/snippet}
    </Field>
    {#snippet aside()}
      {s.auth.haveAccount}
      <a href="/login" class="text-accent underline">{s.auth.logInTitle}</a>
    {/snippet}
  </AuthForm>
</PageFrame>
{/if}
