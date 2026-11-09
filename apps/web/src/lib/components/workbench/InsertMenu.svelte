<script lang="ts">
  /**
   * The workbench's Insert menu: page, column and paragraph breaks, which
   * begin the caret's line, and the objects made at the caret. No selection
   * is needed. While the menu is open the text shows where a break would go,
   * and each break says what it would do.
   */
  import { DropdownMenu } from 'bits-ui';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Plus from '@lucide/svelte/icons/plus';
  import type { BreakChoices } from '$lib/editor/editor';
  import type { BreakType } from '$lib/editor/lines';
  import type { MarkAttrs } from '$lib/editor/marks';
  import type { ObjectType } from '@varians/core';
  import { workbench } from '$lib/strings/workbench';
  import { nextUnplacedPage } from '$lib/workbench/pages';
  import type { Workbench } from './workbench.svelte';

  let { wb }: { wb: Workbench } = $props();

  const t = workbench.insert;

  let choices = $state<BreakChoices | null>(null);
  /** The page a new page break will be given. */
  let nextPage = $state<string | null>(null);

  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const pageShortcut = mac ? '⇧⌘P' : 'Ctrl+Shift+P';

  const breaks: { type: BreakType; label: string }[] = [
    { type: 'page', label: t.page },
    { type: 'column', label: t.column },
    { type: 'paragraph', label: t.paragraph },
  ];

  const objects: { type: ObjectType; label: string; hint?: string; attrs?: MarkAttrs }[] = [
    { type: 'gap', label: t.gap, hint: t.gapHint, attrs: { reason: 'lost' } },
    { type: 'space', label: t.space, hint: t.spaceHint },
    { type: 'figure', label: t.figure },
    { type: 'note', label: t.note },
  ];

  function onOpenChange(open: boolean) {
    const api = wb.api;
    if (open) {
      choices = api?.breakChoices() ?? null;
      nextPage = nextUnplacedPage(wb.stream, wb.streamPages, wb.pages)?.label ?? null;
      api?.previewBreak('any');
    } else {
      api?.previewBreak(null);
    }
  }

  function hint(type: BreakType, c: BreakChoices): string {
    const target = c[type];
    if (target.t === 'none') {
      if (type === 'page' || target.reason === 'page') return t.beginsPage(c.line, c.begins ?? '');
      return t.already[type](c.line);
    }
    return type === 'page' ? t.begins.page(c.line, nextPage) : t.begins[type](c.line);
  }

  const itemClass =
    'flex w-full cursor-default flex-col items-start gap-0 rounded px-2 py-1.5 text-left text-ink outline-none select-none data-highlighted:bg-sunken data-disabled:pointer-events-none data-disabled:opacity-50';
  const headingClass = 'px-2 pt-1 pb-0.5 text-xs text-ink-muted';
</script>

<DropdownMenu.Root {onOpenChange}>
  <DropdownMenu.Trigger
    class="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-ink hover:bg-sunken data-[state=open]:bg-sunken"
    title={t.title}
  >
    <Plus class="size-4 text-ink-muted" aria-hidden="true" />
    {t.label}
    <ChevronDown class="size-3.5 text-ink-muted" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      align="end"
      sideOffset={6}
      class="z-50 w-72 rounded-md border border-line bg-surface p-1 font-sans text-sm shadow-pop outline-none animate-fade-in"
      onCloseAutoFocus={(event) => {
        // Back to the text, with the caret where it was.
        event.preventDefault();
        wb.api?.focus();
      }}
    >
      {#if choices}
        {@const c = choices}
        <DropdownMenu.Group>
          <DropdownMenu.GroupHeading class={headingClass}>{t.breaksHeading(c.line)}</DropdownMenu.GroupHeading>
          {#each breaks as item (item.type)}
            <DropdownMenu.Item
              class={itemClass}
              disabled={c[item.type].t === 'none'}
              onfocus={() => wb.api?.previewBreak(item.type)}
              onSelect={() => wb.api?.insertBreak(item.type)}
            >
              <span class="flex w-full items-baseline gap-2">
                <span class="flex-1">{item.label}</span>
                {#if item.type === 'page'}<kbd class="font-sans text-xs text-ink-muted">{pageShortcut}</kbd>{/if}
              </span>
              <span class="text-xs text-ink-muted">{hint(item.type, c)}</span>
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Group>
        <DropdownMenu.Separator class="my-1 h-px bg-line" />
        <DropdownMenu.Group>
          <DropdownMenu.GroupHeading class={headingClass}>{t.objectsHeading}</DropdownMenu.GroupHeading>
          {#each objects as item (item.type)}
            <DropdownMenu.Item
              class={itemClass}
              onfocus={() => wb.api?.previewBreak(null)}
              onSelect={() => wb.api?.insertObject(item.type, item.attrs)}
            >
              <span>{item.label}</span>
              {#if item.hint}<span class="text-xs text-ink-muted">{item.hint}</span>{/if}
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Group>
        <DropdownMenu.Separator class="my-1 h-px bg-line" />
        <p class="px-2 py-1 text-xs leading-snug text-ink-muted">{t.footnote}</p>
      {:else}
        <p class="px-2 py-1.5 text-ink-muted">{t.noCaret}</p>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
