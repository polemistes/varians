<script lang="ts">
  /**
   * An edition's buttons and menu, the same wherever they stand: on a card,
   * at the end of a row, in the reader's bar, in the editor's header, on
   * Edition Settings. Every item works from here: Publish… and Withdraw
   * Version… open their windows, deleting asks in the application's window,
   * copying opens its own.
   */
  import { Button, ConfirmDialog, RecordActions } from '$lib/components/ui';
  import CopyDialog from '$lib/components/registry/CopyDialog.svelte';
  import PublishDialog from '$lib/components/version/PublishDialog.svelte';
  import WithdrawDialog from '$lib/components/version/WithdrawDialog.svelte';
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

  let publishOpen = $state(false);
  let withdrawOpen = $state(false);
  let deleteOpen = $state(false);
  let copyOpen = $state(false);

  async function act(id: string) {
    if (id === 'copy') {
      await flush?.();
      copyOpen = true;
    } else if (id === 'publish') publishOpen = true;
    else if (id === 'withdraw') withdrawOpen = true;
    else if (id === 'delete') deleteOpen = true;
  }
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

{#if rights.publish}
  <PublishDialog bind:open={publishOpen} kind="edition" id={edition.id} {flush} />
  <WithdrawDialog bind:open={withdrawOpen} kind="edition" id={edition.id} />
{/if}

{#if rights.delete}
  <ConfirmDialog
    bind:open={deleteOpen}
    title={t.deleteTitle}
    description={t.deleteBody}
    confirmLabel={t.deleteVerb}
    action={`/editions/${slug}/edit?/delete`}
    fields={place === 'list' ? { stay: '1' } : {}}
    done={t.deleted(edition.title)}
  />
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
