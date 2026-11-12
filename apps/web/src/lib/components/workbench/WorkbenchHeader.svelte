<script lang="ts">
  /**
   * The workbench's header: the witness and the transcript, and at the right
   * the view controls (the side the facsimile stands on, the side pane's
   * toggle) and the transcript's menu, the same as in every list the
   * transcript stands in. Beside the name, which state is shown: Draft, or
   * the version read only with its date, and the Versions menu with, for
   * those who may edit, the way back to the draft. What is done to the text
   * and not to the record is in the Tools menu above the text. The page
   * chooser is in the bar above the text.
   */
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
  import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
  import PanelRightClose from '@lucide/svelte/icons/panel-right-close';
  import PanelRightOpen from '@lucide/svelte/icons/panel-right-open';
  import Pencil from '@lucide/svelte/icons/pencil';
  import TranscriptionActions from '$lib/components/transcription/TranscriptionActions.svelte';
  import { Badge, IconButton, LocalDate, MenuItem } from '$lib/components/ui';
  import VersionsMenu from '$lib/components/version/VersionsMenu.svelte';
  import type { ReaderVersion } from '$lib/reader/types';
  import type { TranscriptionRights } from '$lib/transcription/actions';
  import { versions as v } from '$lib/strings/versions';
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
    /** The versions, newest first, as the page's data has them now. */
    versions: ReaderVersion[];
    latestVersion: number | null;
    /** The version shown read only, with its date and note; null for the draft. */
    shownVersion: number | null;
    shown: { at: string; note: string | null } | null;
    /** The viewer may edit the draft: a version shown leads back to it. */
    canEditDraft: boolean;
  }

  let {
    wb,
    rights,
    paneOpen,
    ontogglepane,
    onsettings,
    oncopy,
    paneLeft,
    onpaneleft,
    versions,
    latestVersion,
    shownVersion,
    shown,
    canEditDraft,
  }: Props = $props();

  const draftHref = $derived(`/transcriptions/${encodeURIComponent(wb.id)}`);
</script>

{#snippet draftItem()}
  <MenuItem href={draftHref}>
    {#snippet icon()}<Pencil aria-hidden="true" />{/snippet}
    {v.menu.showDraft}
  </MenuItem>
{/snippet}

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
    {#if shownVersion === null}
      <Badge>{v.draft}</Badge>
    {:else if shown}
      <span class="text-xs whitespace-nowrap text-ink-soft" title={shown.note ?? undefined}
        >{v.published(shownVersion)} <LocalDate date={shown.at} /></span
      >
    {/if}
    {#if !wb.canEdit}<Badge tone="accent">{t.readOnly}</Badge>{/if}
    {#if shownVersion !== null && canEditDraft}
      <a href={draftHref} class="text-xs whitespace-nowrap text-accent hover:underline"
        >{v.menu.showDraft}</a
      >
    {/if}
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
    <VersionsMenu
      {versions}
      after={shownVersion !== null && canEditDraft ? draftItem : undefined}
    />
    <TranscriptionActions
      transcription={{ id: wb.id, name: wb.name, latestVersion }}
      {rights}
      place="workbench"
      flush={() => wb.flush()}
      {onsettings}
      {oncopy}
      ondeletestart={() => wb.stop()}
      ondeleterefused={() => location.reload()}
    />
  </div>
</div>
