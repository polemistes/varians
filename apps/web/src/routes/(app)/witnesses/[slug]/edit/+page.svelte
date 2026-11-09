<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { PageFrame } from '$lib/components/shell';
  import { Button, toasts } from '$lib/components/ui';
  import {
    ConfirmDialog,
    FormSection,
    MaintainersEditor,
    WitnessFields,
  } from '$lib/components/registry';
  import { registry as t } from '$lib/strings/registry';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const s = t.witness;
  const witness = $derived(data.witness);
  const detailsFailed = $derived(
    form && 'form' in form && form.form === 'details' && 'errors' in form ? form : null,
  );
  const errors = $derived((detailsFailed?.errors ?? {}) as Record<string, string[] | undefined>);
  const values = $derived(
    detailsFailed && 'values' in detailsFailed && detailsFailed.values
      ? (detailsFailed.values as Record<string, string>)
      : (witness as unknown as Record<string, string | null>),
  );

  let saving = $state(false);
  let deleteOpen = $state(false);

  const save: SubmitFunction = () => {
    saving = true;
    return async ({ result, update }) => {
      saving = false;
      if (result.type === 'success' && result.data?.message)
        toasts.success(String(result.data.message));
      await update({ reset: false });
    };
  };
</script>

<PageFrame title={s.editTitle(witness.name)} width="page">
  <FormSection title={s.detailsSection}>
    <form
      method="post"
      action="?/details"
      class="flex flex-col gap-6"
      novalidate
      use:enhance={save}
    >
      <WitnessFields {values} {errors} />
      <div><Button type="submit" variant="primary" loading={saving}>{s.save}</Button></div>
    </form>
  </FormSection>

  <FormSection title={s.maintainersSection} hint={s.maintainersHint}>
    <MaintainersEditor maintainers={data.maintainers} canManage={data.can.govern} selfId={data.user?.id ?? null} />
  </FormSection>

  {#if data.can.delete}
    <FormSection title={s.deleteSection} hint={s.deleteHint} danger>
      <Button variant="danger" onclick={() => (deleteOpen = true)}>{s.deleteAction}</Button>
    </FormSection>
  {/if}
</PageFrame>

<ConfirmDialog
  bind:open={deleteOpen}
  title={s.deleteTitle}
  description={s.deleteConfirm(witness.name)}
  action="?/delete"
  done={s.deleted(witness.name)}
/>
