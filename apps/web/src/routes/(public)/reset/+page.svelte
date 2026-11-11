<script lang="ts">
  import AuthForm from '$lib/components/auth/AuthForm.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { Field, Input, Notice } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<PageFrame title={s.auth.resetTitle} width="narrow">
  {#if !data.mail}
    <Notice>{s.auth.resetWithoutMail}</Notice>
  {:else if form && 'sent' in form}
    <Notice kind="success">{s.auth.resetSent}</Notice>
  {:else}
    <AuthForm formError={form?.errors?.form} submitLabel={s.auth.resetAction}>
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
      {#snippet aside()}
        <a href="/login" class="text-accent underline">{s.auth.logInLink}</a>
      {/snippet}
    </AuthForm>
  {/if}
</PageFrame>
