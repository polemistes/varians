<script lang="ts">
  /** Import entries from a .bib file or pasted biblatex. */
  import { enhance } from '$app/forms';
  import { Button, Dialog, Field, Input, Notice, Textarea, toasts } from '$lib/components/ui';
  import { bibStrings as t } from '$lib/strings/bibliography';

  interface Props {
    open: boolean;
  }

  let { open = $bindable() }: Props = $props();
  let message = $state<string | null>(null);
  let warnings = $state<string[]>([]);
  let busy = $state(false);

  $effect(() => {
    if (open) {
      message = null;
      warnings = [];
    }
  });

  interface Summary {
    created: string[];
    updated: string[];
    unchanged: string[];
    kept: string[];
    warnings: string[];
  }
</script>

<Dialog bind:open title={t.importDialog.title} description={t.importDialog.description} size="lg">
  <form
    id="bib-import-form"
    method="POST"
    action="?/import"
    enctype="multipart/form-data"
    class="flex flex-col gap-4"
    use:enhance={() => {
      busy = true;
      return async ({ result, update }) => {
        busy = false;
        if (result.type === 'failure') {
          message = (result.data as { message?: string } | undefined)?.message ?? null;
          return;
        }
        if (result.type === 'success') {
          const summary = (result.data as { summary?: Summary } | undefined)?.summary;
          if (summary) {
            toasts.success(
              t.importDialog.summary(
                summary.created.length,
                summary.updated.length,
                summary.unchanged.length,
                summary.kept.length,
              ),
            );
            warnings = summary.warnings;
          }
          if (!summary?.warnings.length) open = false;
        }
        await update();
      };
    }}
  >
    {#if message}<Notice kind="error">{message}</Notice>{/if}
    {#if warnings.length}
      <Notice kind="warning">
        <ul class="list-disc pl-4">
          {#each warnings.slice(0, 8) as warning, i (i)}<li>{warning}</li>{/each}
        </ul>
      </Notice>
    {/if}
    <Field label={t.importDialog.file}>
      {#snippet children(control)}<Input
          {...control}
          type="file"
          name="file"
          accept=".bib,.bibtex,text/plain"
        />{/snippet}
    </Field>
    <Field label={t.importDialog.text}>
      {#snippet children(control)}<Textarea
          {...control}
          name="text"
          rows={8}
          spellcheck={false}
          class="font-mono text-xs"
        />{/snippet}
    </Field>
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{t.importDialog.cancel}</Button>
    <Button variant="primary" type="submit" form="bib-import-form" loading={busy}
      >{t.importDialog.run}</Button
    >
  {/snippet}
</Dialog>
