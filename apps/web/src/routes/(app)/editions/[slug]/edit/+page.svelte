<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import EditionWorkspace, { type WorkspaceController, type WorkspaceStatus } from '$lib/components/edition/EditionWorkspace.svelte';
  import EditionSettingsDialog from '$lib/components/edition/EditionSettingsDialog.svelte';
  import SiglaDialog from '$lib/components/edition/SiglaDialog.svelte';
  import CollaboratorsDialog from '$lib/components/edition/CollaboratorsDialog.svelte';
  import { Badge, Button, Dialog, Field, Input, Menu, MenuItem, MenuSeparator, Notice, toasts } from '$lib/components/ui';
  import { editor as s } from '$lib/strings/editor';
  import { registry } from '$lib/strings/registry';
  import { page } from '$app/state';
  import CopyDialog from '$lib/components/registry/CopyDialog.svelte';
  import type { EditionViewClient } from '$lib/edition/types';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  let controller = $state<WorkspaceController | null>(null);
  let status = $state<WorkspaceStatus>({ pending: 0, saving: false, error: null, version: 0 });
  let publishing = $state(false);
  let settingsOpen = $state(false);
  let siglaOpen = $state(false);
  let collaboratorsOpen = $state(false);
  let ownershipOpen = $state(false);
  let ownershipMessage = $state<string | null>(null);
  let deleteForm = $state<HTMLFormElement | null>(null);
  let copyOpen = $state(false);
  /** After a copy: how many witnesses came without a transcription the copier may see. */
  const without = $derived(Number(page.url.searchParams.get('without')) || 0);

  const statusText = $derived(
    status.error ? s.workspace.saveError(status.error) : status.saving ? s.workspace.savingText : status.pending ? s.workspace.unsaved(status.pending) : s.workspace.saved,
  );

  async function publish(action: 'publish' | 'unpublish') {
    if (!confirm(action === 'publish' ? s.workspace.publishConfirm : s.workspace.unpublishConfirm)) return;
    publishing = true;
    try {
      await controller?.flush();
      const response = await fetch(`/api/editions/${data.edition.id}/publish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? response.statusText);
      }
      const result = (await response.json()) as { number?: number };
      if (action === 'publish' && result.number) toasts.success(s.workspace.published(result.number));
      await invalidateAll();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : String(error));
    } finally {
      publishing = false;
    }
  }

  async function beforeDialog(open: () => void) {
    await controller?.flush();
    open();
  }
</script>

<div class="flex items-center gap-3 border-b border-line bg-surface px-4 py-2 font-sans text-sm">
  <h1 class="min-w-0 truncate font-serif text-lg text-ink">{data.edition.title}</h1>
  <Badge tone={data.edition.visibility === 'published' ? 'success' : 'neutral'}>{data.edition.visibility === 'published' ? `v${data.versions[0]?.number ?? ''}` : s.dialogs.draft}</Badge>
  <span class={['text-xs', status.error ? 'text-danger' : 'text-ink-muted']} aria-live="polite">{statusText}</span>
  <span class="ml-auto flex items-center gap-2">
    <Button size="sm" variant="ghost" href={`/editions/${data.edition.slug}?draft=1`}>{s.workspace.preview}</Button>
    {#if data.can.publish}
      <Button size="sm" variant="primary" loading={publishing} onclick={() => publish('publish')}>{s.workspace.publish}</Button>
    {/if}
    <Menu label={s.dialogs.more} triggerVariant="ghost" triggerSize="sm" align="end">
      {#snippet trigger()}⋯{/snippet}
      <MenuItem onSelect={() => beforeDialog(() => (settingsOpen = true))}>{s.workspace.settings}</MenuItem>
      <MenuItem onSelect={() => beforeDialog(() => (siglaOpen = true))}>{s.workspace.witnessList}</MenuItem>
      {#if data.can.grant}
        <MenuItem onSelect={() => (collaboratorsOpen = true)}>{s.workspace.collaborators}</MenuItem>
        <MenuItem onSelect={() => { ownershipMessage = null; ownershipOpen = true; }}>{s.dialogs.ownership.menu}</MenuItem>
      {/if}
      <MenuSeparator />
      <MenuItem href={`/editions/${data.edition.slug}`}>{s.workspace.readerLink}</MenuItem>
      <MenuItem href={`/editions/${data.edition.slug}.txt`} file>{s.workspace.downloadText}</MenuItem>
      <MenuItem href={`/editions/${data.edition.slug}.tei.xml`} file>{s.workspace.downloadTei}</MenuItem>
      {#if data.can.publish && data.edition.visibility === 'published'}
        <MenuItem onSelect={() => publish('unpublish')}>{s.workspace.unpublish}</MenuItem>
      {/if}
      <MenuSeparator />
      <MenuItem onSelect={() => beforeDialog(() => (copyOpen = true))}>{s.workspace.copyEdition}</MenuItem>
      {#if data.can.delete}
        <MenuSeparator />
        <MenuItem danger onSelect={() => { if (confirm(s.workspace.deleteConfirm)) deleteForm?.requestSubmit(); }}>{s.workspace.deleteEdition}</MenuItem>
      {/if}
    </Menu>
  </span>
</div>

{#if without}
  <div class="border-b border-line bg-surface px-4 py-2"><Notice kind="warning">{registry.copy.withoutTranscription(without)}</Notice></div>
{/if}

{#key data.revision}
  <EditionWorkspace
    view={data.view as unknown as EditionViewClient}
    reviewed={data.reviewed}
    canEdit={true}
    userName={data.user?.name ?? ''}
    bind:controller
    onstatus={(next) => (status = next)}
  />
{/key}

<EditionSettingsDialog bind:open={settingsOpen} edition={data.edition} onsaved={() => toasts.success(s.dialogs.saved)} />
<SiglaDialog bind:open={siglaOpen} sigla={data.sigla} candidates={data.candidates} reportedOnly={data.reportedOnly} witnessHands={data.witnessHands} onsaved={() => toasts.success(s.dialogs.saved)} />
{#if data.can.grant}
  <CollaboratorsDialog bind:open={collaboratorsOpen} collaborators={data.collaborators} />
{/if}
<form method="POST" action="?/delete" bind:this={deleteForm} use:enhance class="hidden"></form>
<CopyDialog
  bind:open={copyOpen}
  title={registry.copy.editionTitle}
  description={registry.copy.editionBodyEditor}
  proposed={registry.copy.proposed(data.edition.title)}
  action={`/editions/${encodeURIComponent(data.edition.slug)}/copy`}
  label={registry.copy.title}
/>

<Dialog bind:open={ownershipOpen} title={s.dialogs.ownership.title} description={s.dialogs.ownership.description} size="sm">
  {#if ownershipMessage}<Notice kind="error">{ownershipMessage}</Notice>{/if}
  <form
    method="POST"
    action="?/offerOwnership"
    class="flex items-end gap-2"
    use:enhance={() =>
      async ({ result, update }) => {
        if (result.type === 'failure') {
          ownershipMessage = (result.data as { message?: string } | undefined)?.message ?? s.dialogs.ownership.notOffered;
          return;
        }
        ownershipOpen = false;
        toasts.success(s.dialogs.ownership.offered);
        await update();
      }}
  >
    <Field label={s.dialogs.ownership.email} class="flex-1">
      {#snippet children(control)}<Input {...control} name="email" type="email" required />{/snippet}
    </Field>
    <Button type="submit" variant="primary">{s.dialogs.ownership.offer}</Button>
  </form>
</Dialog>
