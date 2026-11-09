<script lang="ts">
  import { enhance } from '$app/forms';
  import { PageFrame } from '$lib/components/shell';
  import { Button, Notice, toasts } from '$lib/components/ui';
  import { WitnessFields } from '$lib/components/registry';
  import { registry as t } from '$lib/strings/registry';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  let submitting = $state(false);
  const errors = $derived((form?.errors ?? {}) as Record<string, string[] | undefined>);
  const values = $derived((form?.values ?? {}) as Record<string, string>);
</script>

<PageFrame title={t.witness.newTitle} width="reading">
  <form
    method="post"
    novalidate
    class="flex flex-col gap-10"
    use:enhance={({ formData }) => {
      submitting = true;
      const name = String(formData.get('name') ?? '').trim();
      return async ({ result, update }) => {
        submitting = false;
        if (result.type === 'redirect') toasts.success(t.witness.created(name));
        await update({ reset: false });
      };
    }}
  >
    {#if form?.errors}<Notice kind="error">{t.common.invalidForm}</Notice>{/if}
    <WitnessFields {values} {errors} search />
    <div class="flex items-center gap-3 border-t border-line pt-6">
      <Button type="submit" variant="primary" loading={submitting}>{t.witness.create}</Button>
      <Button href={data.returnTo ?? '/'} variant="ghost">{t.common.cancel}</Button>
    </div>
  </form>
</PageFrame>
