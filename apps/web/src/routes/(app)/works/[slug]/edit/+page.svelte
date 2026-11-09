<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { PageFrame } from '$lib/components/shell';
  import { Button, toasts } from '$lib/components/ui';
  import {
    ConfirmDialog,
    FormSection,
    MaintainersEditor,
    SchemeEditor,
    VisibilityField,
    WorkFields,
  } from '$lib/components/registry';
  import { registry as t } from '$lib/strings/registry';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  type Errors = Record<string, string[] | undefined>;
  const errorsOf = (name: string): Errors =>
    form && 'form' in form && form.form === name && 'errors' in form
      ? ((form.errors ?? {}) as Errors)
      : {};

  const work = $derived(data.work);
  const detailValues = $derived(
    form && 'form' in form && form.form === 'details' && 'values' in form && form.values
      ? (form.values as Record<string, string>)
      : {
          title: work.title,
          author: work.author ?? '',
          language: work.language,
          identifier: work.identifier ?? '',
          description: work.description ?? '',
        },
  );

  let pending = $state<string | null>(null);
  let deleteOpen = $state(false);

  /** Saves a section in place: a toast on success, the errors beside the fields otherwise. */
  function saving(name: string): SubmitFunction {
    return () => {
      pending = name;
      return async ({ result, update }) => {
        pending = null;
        if (result.type === 'success' && result.data?.message)
          toasts.success(String(result.data.message));
        await update({ reset: false });
      };
    };
  }
</script>

<PageFrame title={t.work.editTitle(work.title)} width="page">
  <FormSection title={t.work.detailsSection}>
    <form
      method="post"
      action="?/details"
      class="flex flex-col gap-6"
      novalidate
      use:enhance={saving('details')}
    >
      <WorkFields values={detailValues} errors={errorsOf('details')} />
      <div>
        <Button type="submit" variant="primary" loading={pending === 'details'}
          >{t.work.save}</Button
        >
      </div>
    </form>
  </FormSection>

  {#if data.can.govern}
  <FormSection title={t.work.visibilitySection}>
    <form
      method="post"
      action="?/visibility"
      class="flex flex-col gap-6"
      use:enhance={saving('visibility')}
    >
      <VisibilityField value={work.visibility} quietLegend />
      <div>
        <Button type="submit" variant="primary" loading={pending === 'visibility'}
          >{t.work.save}</Button
        >
      </div>
    </form>
  </FormSection>
  {/if}

  <FormSection title={t.work.schemeSection}>
    <form
      method="post"
      action="?/scheme"
      class="flex flex-col gap-6"
      use:enhance={saving('scheme')}
    >
      <SchemeEditor
        mode="edit"
        levels={data.scheme.levels}
        locked={data.locked}
        error={errorsOf('scheme').scheme}
      />
      <div>
        <Button type="submit" variant="primary" loading={pending === 'scheme'}
          >{t.scheme.save}</Button
        >
      </div>
    </form>
  </FormSection>

  <FormSection title={t.work.maintainersSection} hint={t.work.maintainersHint}>
    <MaintainersEditor maintainers={data.maintainers} canManage={data.can.govern} selfId={data.user?.id ?? null} />
  </FormSection>

  {#if data.can.delete}
    <FormSection title={t.work.deleteSection} hint={t.work.deleteHint} danger>
      <Button variant="danger" onclick={() => (deleteOpen = true)}>{t.work.deleteAction}</Button>
    </FormSection>
  {/if}
</PageFrame>

<ConfirmDialog
  bind:open={deleteOpen}
  title={t.work.deleteTitle}
  description={t.work.deleteConfirm(work.title)}
  action="?/delete"
  done={t.work.deleted(work.title)}
/>
