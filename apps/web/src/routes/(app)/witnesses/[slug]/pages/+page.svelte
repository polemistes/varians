<script lang="ts">
  import AddPagesForm from '$lib/components/pages/AddPagesForm.svelte';
  import ManifestImport from '$lib/components/pages/ManifestImport.svelte';
  import PageGrid from '$lib/components/pages/PageGrid.svelte';
  import UploadImages from '$lib/components/pages/UploadImages.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { EmptyState, Notice } from '$lib/components/ui';
  import { pageStrings as t } from '$lib/strings/pages';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const withImage = $derived(data.pages.filter((p) => p.imageKind).length);
  const lastLabel = $derived(data.pages.at(-1)?.label ?? null);

  // Results reach `form` only when a form was sent without script; with
  // script the components show their own results and toasts.
  const addFailure = $derived(form?.action === 'add' && !form.ok ? form : null);
  const uploadResult = $derived(form?.action === 'upload' ? form : null);
  /** What the page itself reports: every success but an upload's, and the failures no form shows. */
  const notice = $derived.by(() => {
    if (!form || form.action === 'upload') return null;
    if (form.ok) return 'message' in form && form.message ? { kind: 'success' as const, text: form.message } : null;
    if (form.action === 'add') return null;
    return 'error' in form && form.error ? { kind: 'error' as const, text: form.error } : null;
  });
</script>

<PageFrame title={t.title(data.witness.name)} lead={t.lead(data.witness.siglum, data.pages.length, withImage)}>
  {#snippet actions()}
    <ManifestImport manifestUrl={data.witness.iiifManifest} hasPages={data.pages.length > 0} />
  {/snippet}

  {#if notice}
    <Notice kind={notice.kind} class="mb-6">{notice.text}</Notice>
  {/if}

  <div class="mb-10 grid items-start gap-4 lg:grid-cols-2">
    <UploadImages {lastLabel} maxBytes={data.maxUploadBytes} result={uploadResult} />
    <AddPagesForm failure={addFailure} roll={data.witness.roll} />
  </div>

  {#if data.pages.length === 0}
    <EmptyState title={t.empty} description={t.emptyHint} />
  {:else}
    <PageGrid pages={data.pages} maxUploadBytes={data.maxUploadBytes} />
  {/if}
</PageFrame>
