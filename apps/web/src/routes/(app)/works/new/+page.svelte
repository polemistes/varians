<script lang="ts">
  import { enhance } from '$app/forms';
  import { PageFrame } from '$lib/components/shell';
  import { Button, Notice, toasts } from '$lib/components/ui';
  import { SchemeEditor, WorkFields } from '$lib/components/registry';
  import { CUSTOM_SCHEME } from '$lib/registry/constants';
  import { parseLevels } from '$lib/registry/scheme';
  import { registry as t } from '$lib/strings/registry';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  let submitting = $state(false);
  const errors = $derived((form?.errors ?? {}) as Record<string, string[] | undefined>);
  const values = $derived((form?.values ?? {}) as Record<string, string>);
  const levels = $derived(
    values.scheme === CUSTOM_SCHEME ? (parseLevels(values.levels ?? '') ?? undefined) : undefined,
  );
</script>

<PageFrame title={t.work.newTitle} lead={t.work.publicNote} width="reading">
  <form
    method="post"
    novalidate
    class="flex flex-col gap-10"
    use:enhance={({ formData }) => {
      submitting = true;
      const title = String(formData.get('title') ?? '').trim();
      return async ({ result, update }) => {
        submitting = false;
        if (result.type === 'redirect') toasts.success(t.work.created(title));
        await update({ reset: false });
      };
    }}
  >
    {#if form?.errors}<Notice kind="error">{t.common.invalidForm}</Notice>{/if}
    <WorkFields {values} {errors} search />
    <SchemeEditor choice={values.scheme || undefined} {levels} error={errors.scheme} />
    <div class="flex items-center gap-3 border-t border-line pt-6">
      <Button type="submit" variant="primary" loading={submitting}>{t.work.create}</Button>
      <Button href={data.forEdition ? '/start/edition' : '/'} variant="ghost"
        >{t.common.cancel}</Button
      >
    </div>
  </form>
</PageFrame>
