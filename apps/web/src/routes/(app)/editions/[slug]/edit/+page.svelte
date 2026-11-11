<script lang="ts">
  import EditionWorkspace, {
    type WorkspaceController,
    type WorkspaceStatus,
  } from '$lib/components/edition/EditionWorkspace.svelte';
  import EditionActions from '$lib/components/edition/EditionActions.svelte';
  import SiglaDialog from '$lib/components/edition/SiglaDialog.svelte';
  import { Badge, Notice, toasts } from '$lib/components/ui';
  import { editor as s } from '$lib/strings/editor';
  import { registry } from '$lib/strings/registry';
  import { page } from '$app/state';
  import type { EditionViewClient } from '$lib/edition/types';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  let controller = $state<WorkspaceController | null>(null);
  let status = $state<WorkspaceStatus>({ pending: 0, saving: false, error: null, version: 0 });
  let siglaOpen = $state(false);
  /** After a copy: how many witnesses came without a transcription the copier may see. */
  const without = $derived(Number(page.url.searchParams.get('without')) || 0);

  const statusText = $derived(
    status.error
      ? s.workspace.saveError(status.error)
      : status.saving
        ? s.workspace.savingText
        : status.pending
          ? s.workspace.unsaved(status.pending)
          : s.workspace.saved,
  );

  /** What is pending is saved before the edition is published or copied, or a window over it opens. */
  async function flush() {
    await controller?.flush();
  }
</script>

<div class="flex items-center gap-3 border-b border-line bg-surface px-4 py-2 font-sans text-sm">
  <h1 class="min-w-0 truncate font-serif text-lg text-ink">{data.edition.title}</h1>
  <Badge tone={data.edition.visibility === 'published' ? 'success' : 'neutral'}
    >{data.edition.visibility === 'published'
      ? `v${data.versions[0]?.number ?? ''}`
      : s.dialogs.draft}</Badge
  >
  <span class={['text-xs', status.error ? 'text-danger' : 'text-ink-muted']} aria-live="polite"
    >{statusText}</span
  >
  <EditionActions
    edition={{
      id: data.edition.id,
      slug: data.edition.slug,
      title: data.edition.title,
      published: data.edition.visibility === 'published',
    }}
    rights={data.rights}
    place="editor"
    {flush}
    publishButton
    class="ml-auto"
  />
</div>

{#if without}
  <div class="border-b border-line bg-surface px-4 py-2">
    <Notice kind="warning">{registry.copy.withoutTranscription(without)}</Notice>
  </div>
{/if}

{#key data.revision}
  <EditionWorkspace
    view={data.view as unknown as EditionViewClient}
    reviewed={data.reviewed}
    canEdit={true}
    userName={data.user?.name ?? ''}
    bind:controller
    onstatus={(next) => (status = next)}
    onsigla={async () => {
      await flush();
      siglaOpen = true;
    }}
  />
{/key}

<SiglaDialog
  bind:open={siglaOpen}
  editionSlug={data.edition.slug}
  work={data.work}
  conspectus={data.conspectus}
  suggestions={data.suggestions}
  sources={data.sources}
  onsaved={() => toasts.success(s.dialogs.saved)}
/>
