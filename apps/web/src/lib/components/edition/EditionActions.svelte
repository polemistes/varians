<script lang="ts">
  /**
   * An edition's buttons and menu, the same wherever they stand: on a card,
   * at the end of a row, in the reader's bar, in the editor's header, on
   * Edition Settings. Every item works from here: publishing, taking back
   * and deleting ask in the application's window, copying opens its own.
   */
  import { invalidateAll } from '$app/navigation';
  import { Button, ConfirmDialog, RecordActions, toasts } from '$lib/components/ui';
  import CopyDialog from '$lib/components/registry/CopyDialog.svelte';
  import {
    editionActions,
    type EditionDownloads,
    type EditionPlace,
    type EditionRights,
  } from '$lib/edition/actions';
  import { recordActions } from '$lib/strings/record-actions';
  import { registry } from '$lib/strings/registry';

  interface Props {
    edition: { id: string; slug: string; title: string; published: boolean };
    rights: EditionRights;
    place: EditionPlace;
    /** In the reader, the downloads of the state shown. */
    downloads?: EditionDownloads;
    /** Run before publishing or copying: the editor saves what is pending. */
    flush?: () => Promise<void>;
    /** The editor's own Publish button, before Read. */
    publishButton?: boolean;
    class?: string;
  }

  let {
    edition,
    rights,
    place,
    downloads,
    flush,
    publishButton = false,
    class: className,
  }: Props = $props();

  const t = recordActions.edition;
  const actions = $derived(
    editionActions(edition, rights, place, {
      ...(downloads ? { downloads } : {}),
      ...(place === 'list' ? { name: edition.title } : {}),
    }),
  );
  const slug = $derived(encodeURIComponent(edition.slug));

  type Asking = 'publish' | 'unpublish' | 'delete';
  let asking = $state<Asking>('publish');
  let confirmOpen = $state(false);
  let copyOpen = $state(false);

  async function act(id: string) {
    if (id === 'copy') {
      await flush?.();
      copyOpen = true;
    } else if (id === 'publish' || id === 'unpublish' || id === 'delete') {
      asking = id;
      confirmOpen = true;
    }
  }

  /** Publish or take back through the editors' endpoint; a refusal is returned to the window. */
  async function publish(action: 'publish' | 'unpublish'): Promise<string | null> {
    await flush?.();
    const response = await fetch(`/api/editions/${edition.id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const body = (await response.json().catch(() => null)) as {
      message?: string;
      number?: number;
    } | null;
    if (!response.ok) return body?.message ?? response.statusText;
    toasts.success(action === 'publish' && body?.number ? t.published(body.number) : t.unpublished);
    await invalidateAll();
    return null;
  }

  const ask = $derived(
    asking === 'delete'
      ? {
          title: t.deleteTitle,
          description: t.deleteBody,
          confirmLabel: t.deleteVerb,
          tone: 'danger' as const,
        }
      : asking === 'unpublish'
        ? {
            title: t.unpublishTitle,
            description: t.unpublishBody,
            confirmLabel: t.unpublishVerb,
            tone: 'danger' as const,
          }
        : {
            title: t.publishTitle,
            description: t.publishBody,
            confirmLabel: t.publishVerb,
            tone: 'primary' as const,
          },
  );
</script>

{#snippet publishing()}
  <Button size="sm" variant="primary" onclick={() => act('publish')}>{t.publishButton}</Button>
{/snippet}

<RecordActions
  {actions}
  label={place === 'list' ? recordActions.menuOf(edition.title) : recordActions.menu}
  onaction={act}
  before={publishButton && rights.publish ? publishing : undefined}
  class={className}
/>

{#if rights.publish || rights.delete}
  {#if asking === 'delete'}
    <ConfirmDialog
      bind:open={confirmOpen}
      {...ask}
      action={`/editions/${slug}/edit?/delete`}
      fields={place === 'list' ? { stay: '1' } : {}}
      done={t.deleted(edition.title)}
    />
  {:else}
    <ConfirmDialog
      bind:open={confirmOpen}
      {...ask}
      onconfirm={() => publish(asking === 'unpublish' ? 'unpublish' : 'publish')}
    />
  {/if}
{/if}

{#if rights.signedIn && (rights.edit || edition.published)}
  <CopyDialog
    bind:open={copyOpen}
    title={registry.copy.editionTitle}
    description={rights.edit ? registry.copy.editionBodyEditor : registry.copy.editionBodyReader}
    proposed={registry.copy.proposed(edition.title)}
    action={`/editions/${slug}/copy`}
    label={registry.copy.title}
  />
{/if}
