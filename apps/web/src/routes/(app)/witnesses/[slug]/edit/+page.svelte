<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import RightsFields from '$lib/components/pages/RightsFields.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { Button, Checkbox, toasts } from '$lib/components/ui';
  import { FormSection, MaintainersEditor, WitnessFields } from '$lib/components/registry';
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

  // The defaults for images
  const imagesFailed = $derived(
    form && 'form' in form && form.form === 'images' && 'errors' in form ? form : null,
  );
  const imageErrors = $derived(
    (imagesFailed?.errors ?? {}) as Record<string, string[] | undefined>,
  );
  let imageRights = $state(untrack(() => data.images.imageRights));
  let imageAttribution = $state(untrack(() => data.images.imageAttribution));
  let applyToPages = $state(false);
  let savingImages = $state(false);

  const saveImages: SubmitFunction = () => {
    savingImages = true;
    return async ({ result, update }) => {
      savingImages = false;
      if (result.type === 'success' && result.data?.message) {
        toasts.success(String(result.data.message));
        applyToPages = false;
      }
      await update({ reset: false });
    };
  };

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

  <FormSection title={s.imagesSection} hint={s.imagesHint}>
    <form
      method="post"
      action="?/images"
      class="flex flex-col gap-4"
      novalidate
      use:enhance={saveImages}
    >
      <RightsFields
        bind:rights={imageRights}
        bind:attribution={imageAttribution}
        withSource={false}
        names={{ rights: 'imageRights', attribution: 'imageAttribution', source: '' }}
        rightsLabel={s.imageRights}
        emptyLabel={s.imageRightsNone}
        errors={imageErrors}
      />
      {#if data.images.withoutRights > 0}
        <Checkbox name="apply" bind:checked={applyToPages} disabled={!imageRights}
          >{s.applyToPages(data.images.withoutRights)}</Checkbox
        >
      {/if}
      <div>
        <Button type="submit" variant="primary" loading={savingImages}>{s.imagesSave}</Button>
      </div>
    </form>
  </FormSection>

  <FormSection title={s.maintainersSection} hint={s.maintainersHint}>
    <MaintainersEditor
      maintainers={data.maintainers}
      canManage={data.can.govern}
      selfId={data.user?.id ?? null}
      entry="witness"
    />
  </FormSection>
</PageFrame>
