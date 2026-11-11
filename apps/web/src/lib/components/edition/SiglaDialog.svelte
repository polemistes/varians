<script lang="ts">
  /**
   * Witnesses and Sigla in the editor: the conspectus of Edition Settings in
   * a window, saved through the editor's own `sigla` action. The windows the
   * conspectus opens make their records through Edition Settings' actions.
   */
  import { enhance } from '$app/forms';
  import { Button, Dialog } from '$lib/components/ui';
  import type { ConspectusRow, ConspectusWitness, SuggestedWitness } from '$lib/edition/conspectus';
  import type { GroupDraft } from '$lib/edition/groups';
  import type { TranscriptionOption } from '$lib/registry/types';
  import { editor } from '$lib/strings/editor';
  import ConspectusEditor from './ConspectusEditor.svelte';

  const d = editor.dialogs;

  interface Props {
    open: boolean;
    editionSlug: string;
    work: { id: string; title: string };
    conspectus: {
      rows: ConspectusRow[];
      witnesses: Record<string, ConspectusWitness>;
      groups: GroupDraft[];
    };
    suggestions: SuggestedWitness[];
    sources: TranscriptionOption[];
    onsaved?: () => void;
  }

  let {
    open = $bindable(),
    editionSlug,
    work,
    conspectus,
    suggestions,
    sources,
    onsaved,
  }: Props = $props();

  let message = $state<string | null>(null);
  let saving = $state(false);
  let form = $state<HTMLFormElement | null>(null);

  $effect(() => {
    if (open) message = null;
  });
</script>

<Dialog bind:open title={d.sigla.title} size="lg">
  <form
    method="POST"
    action="?/sigla"
    bind:this={form}
    use:enhance={() => {
      saving = true;
      return async ({ result, update }) => {
        saving = false;
        if (result.type === 'failure') {
          message = (result.data as { message?: string } | undefined)?.message ?? d.notSaved;
          return;
        }
        open = false;
        onsaved?.();
        await update({ reset: false });
      };
    }}
  >
    <ConspectusEditor
      rows={conspectus.rows}
      witnesses={conspectus.witnesses}
      groups={conspectus.groups}
      {work}
      {suggestions}
      {sources}
      actions={`/editions/${encodeURIComponent(editionSlug)}/settings`}
      error={message}
    />
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{d.cancel}</Button>
    <Button variant="primary" loading={saving} onclick={() => form?.requestSubmit()}
      >{d.save}</Button
    >
  {/snippet}
</Dialog>
