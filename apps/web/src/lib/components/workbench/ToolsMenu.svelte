<script lang="ts">
  /**
   * The workbench's Tools menu: what is done to the text and not to the
   * record. Importing text into the transcript and numbering lines from the
   * caret, which are there for the whole text as well; and, on a page,
   * normalizing the diacritics of the words from the analyser, removing one
   * kind of mark from the diplomatic text, and lower or upper case. Those
   * act on the selected words, else on the page shown, and only when
   * chosen; each is one change, undone like typing.
   */
  import { DropdownMenu } from 'bits-ui';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Wrench from '@lucide/svelte/icons/wrench';
  import { toasts } from '$lib/components/ui';
  import type { MarkKind } from '$lib/workbench/diacritics';
  import { workbench } from '$lib/strings/workbench';
  import { WHOLE } from '$lib/workbench/pages';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    /** On a page: the window for taking the forms of one text from the other. */
    ontake: () => void;
    onimport: () => void;
    onnumber: () => void;
  }

  let { wb, ontake, onimport, onnumber }: Props = $props();

  /** The words are changed on a page, not in the whole text, which is read only. */
  const onPage = $derived(wb.view !== WHOLE);

  const t = workbench.tools;
  let busy = $state(false);

  const scope = $derived(
    wb.hasRange && wb.selection.ids.length
      ? t.scopeSelection(wb.selection.ids.length)
      : t.scopePage,
  );

  const removals: { kinds: MarkKind[]; label: string }[] = [
    { kinds: ['accents'], label: t.removeAccents },
    { kinds: ['breathings'], label: t.removeBreathings },
    { kinds: ['diaereses'], label: t.removeDiaereses },
    { kinds: ['iotaSubscripts'], label: t.removeIotaSubscripts },
    { kinds: ['accents', 'breathings', 'diaereses', 'iotaSubscripts'], label: t.removeAll },
  ];

  async function normalize() {
    busy = true;
    const outcome = await wb.normalizeDiacritics();
    busy = false;
    if (!outcome) {
      toasts.error(t.failed);
      return;
    }
    toasts.success(t.normalized(outcome.set, outcome.choose, outcome.unknown));
    const first = wb.nearbyChoice(1);
    if (first) wb.api?.placeCaret(first);
  }

  function changed(n: number) {
    toasts.success(n ? t.changed(n) : t.nothingChanged);
  }

  const itemClass =
    'flex w-full cursor-default flex-col items-start gap-0 rounded px-2 py-1.5 text-left text-ink outline-none select-none data-highlighted:bg-sunken data-disabled:pointer-events-none data-disabled:opacity-50';
  const headingClass = 'px-2 pt-1 pb-0.5 text-xs text-ink-muted';
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-ink hover:bg-sunken data-[state=open]:bg-sunken"
    title={t.title}
  >
    <Wrench class="size-4 text-ink-muted" aria-hidden="true" />
    {t.label}
    <ChevronDown class="size-3.5 text-ink-muted" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      align="end"
      sideOffset={6}
      class="z-50 w-80 rounded-md border border-line bg-surface p-1 font-sans text-sm shadow-pop outline-none animate-fade-in"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        wb.api?.focus();
      }}
    >
      <DropdownMenu.Item class={itemClass} onSelect={onimport}>{t.import}</DropdownMenu.Item>
      <DropdownMenu.Item class={itemClass} onSelect={onnumber}>{t.numberLines}</DropdownMenu.Item>
      {#if onPage}
        <DropdownMenu.Separator class="my-1 h-px bg-line" />
        <p class="px-2 py-1 text-xs text-ink-muted">{scope}</p>
        <DropdownMenu.Separator class="my-1 h-px bg-line" />
        <DropdownMenu.Item class={itemClass} disabled={busy} onSelect={() => void normalize()}>
          <span>{t.normalize}</span>
          <span class="text-xs text-ink-muted"
            >{wb.keepsWrittenForm ? t.normalizeHint : t.normalizeHintOneForm}</span
          >
        </DropdownMenu.Item>
        <DropdownMenu.Item class={itemClass} disabled={busy} onSelect={ontake}>
          <span>{t.takeFrom}</span>
          <span class="text-xs text-ink-muted">{t.takeFromHint}</span>
        </DropdownMenu.Item>
        <DropdownMenu.Separator class="my-1 h-px bg-line" />
        <DropdownMenu.Group>
          <DropdownMenu.GroupHeading class={headingClass}
            >{wb.keepsWrittenForm
              ? t.removeHeading
              : t.removeHeadingOneForm}</DropdownMenu.GroupHeading
          >
          {#each removals as item (item.label)}
            <DropdownMenu.Item
              class={itemClass}
              onSelect={() => changed(wb.removeMarks(item.kinds))}>{item.label}</DropdownMenu.Item
            >
          {/each}
        </DropdownMenu.Group>
        <DropdownMenu.Separator class="my-1 h-px bg-line" />
        <DropdownMenu.Group>
          <DropdownMenu.GroupHeading class={headingClass}
            >{t.caseHeading(
              wb.editorForm === 'written' && wb.keepsWrittenForm,
            )}</DropdownMenu.GroupHeading
          >
          <DropdownMenu.Item class={itemClass} onSelect={() => changed(wb.changeCase('lower'))}
            >{t.lower}</DropdownMenu.Item
          >
          <DropdownMenu.Item class={itemClass} onSelect={() => changed(wb.changeCase('upper'))}
            >{t.upper}</DropdownMenu.Item
          >
        </DropdownMenu.Group>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
