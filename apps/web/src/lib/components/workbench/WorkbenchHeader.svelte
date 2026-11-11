<script lang="ts">
  /**
   * The workbench's header: the witness and the transcript, and at the right
   * the view controls (the side the facsimile stands on, the side pane's
   * toggle) and the transcript's menu, the same as in every list the
   * transcript stands in. What is done to the text and not to the record is
   * in the Tools menu above the text. The page chooser is in the bar above
   * the text.
   */
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
  import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
  import PanelRightClose from '@lucide/svelte/icons/panel-right-close';
  import PanelRightOpen from '@lucide/svelte/icons/panel-right-open';
  import TranscriptionActions from '$lib/components/transcription/TranscriptionActions.svelte';
  import { Badge, IconButton } from '$lib/components/ui';
  import type { TranscriptionRights } from '$lib/transcription/actions';
  import { workbench as t } from '$lib/strings/workbench';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    rights: TranscriptionRights;
    paneOpen: boolean;
    ontogglepane: () => void;
    onsettings: () => void;
    /** Make a copy of one's own; the window opens at once. */
    oncopy: () => void;
    /** The side pane stands left of the text. */
    paneLeft: boolean;
    onpaneleft: (left: boolean) => void;
  }

  let { wb, rights, paneOpen, ontogglepane, onsettings, oncopy, paneLeft, onpaneleft }: Props =
    $props();
</script>

<div
  class="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-1.5 font-sans text-sm"
>
  <div class="flex min-w-0 items-baseline gap-2">
    <a
      href="/witnesses/{wb.witness.slug}"
      class="truncate text-ink hover:text-accent"
      title={t.backToWitness(wb.witness.name)}
    >
      <span class="font-semibold">{wb.witness.siglum}</span>
      <span class="text-ink-muted" aria-hidden="true">·</span>
      <span>{wb.witness.name}</span>
    </a>
    <span class="text-ink-muted" aria-hidden="true">·</span>
    <h1 class="truncate font-medium text-ink">{wb.name}</h1>
    {#if wb.visibility === 'draft'}<Badge>{t.draft}</Badge>{/if}
    {#if !wb.canEdit}<Badge tone="accent">{t.readOnly}</Badge>{/if}
  </div>

  <div class="ml-auto flex flex-wrap items-center gap-3">
    <div class="flex items-center gap-0.5">
      <IconButton
        label={t.menu.paneLeft}
        size="sm"
        aria-pressed={paneLeft}
        class="aria-pressed:bg-sunken aria-pressed:text-ink"
        onclick={() => onpaneleft(!paneLeft)}
      >
        <ArrowLeftRight aria-hidden="true" />
      </IconButton>
      <IconButton
        label={t.menu.togglePane}
        size="sm"
        aria-pressed={paneOpen}
        onclick={ontogglepane}
      >
        {#if paneLeft}
          {#if paneOpen}<PanelLeftClose aria-hidden="true" />{:else}<PanelLeftOpen
              aria-hidden="true"
            />{/if}
        {:else if paneOpen}<PanelRightClose aria-hidden="true" />{:else}<PanelRightOpen
            aria-hidden="true"
          />{/if}
      </IconButton>
    </div>
    <TranscriptionActions
      transcription={{ id: wb.id, name: wb.name }}
      {rights}
      place="workbench"
      {onsettings}
      {oncopy}
      ondeletestart={() => wb.stop()}
      ondeleterefused={() => location.reload()}
    />
  </div>
</div>
