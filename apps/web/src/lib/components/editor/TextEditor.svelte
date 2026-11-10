<script lang="ts">
  /**
   * The transcription text as a CodeMirror document. The parent owns the
   * stream: every edit arrives as operations through `onops` together with
   * the stream they produce, which the parent passes back as `stream`.
   */
  import { onMount, untrack } from 'svelte';
  import type { Id, Op, Stream } from '@varians/core';
  import type { Form } from '$lib/editor/bridge';
  import {
    VariansEditor,
    type CutRecord,
    type Direction,
    type EditorApi,
  } from '$lib/editor/editor';
  import type { TokenClasses } from '$lib/editor/highlight';

  interface Props {
    stream: Stream;
    form: Form;
    readonly?: boolean;
    /** Show one page by its id, the text on no page (`'unplaced'`), or the whole stream (null). */
    page?: string | null;
    /** The witness's pages in order. */
    pageOrder?: readonly string[];
    direction?: Direction;
    lineNumbers?: boolean;
    segmentLabels?: Record<string, string>;
    pageLabels?: Record<string, string>;
    /** Classes to put on tokens, by token id: highlights the host decides. */
    tokenClasses?: TokenClasses;
    /** The name of a hand as a mark records it, for tooltips. */
    handLabel?: (value: string) => string;
    onops?: (ops: Op[], next: Stream) => void;
    onselection?: (tokenIds: Id[], caretTokenId: Id | null) => void;
    ontokenhover?: (tokenId: Id | null) => void;
    onrequestsegment?: (tokenId: Id, current: string | null) => void;
    oncut?: (cut: CutRecord) => void;
    oncopy?: () => void;
    /** True when the parent put the pasted text in itself. */
    onpaste?: (text: string) => boolean;
    onworddblclick?: (tokenId: Id) => void;
    onready?: (api: EditorApi) => void;
    /** The editor's commands, available once mounted. */
    api?: EditorApi | null;
    class?: string;
  }

  let {
    stream,
    form,
    readonly = false,
    page = null,
    pageOrder = [],
    direction = 'auto',
    lineNumbers = true,
    segmentLabels = {},
    pageLabels = {},
    tokenClasses = {},
    handLabel,
    onops,
    onselection,
    ontokenhover,
    onrequestsegment,
    oncut,
    oncopy,
    onpaste,
    onworddblclick,
    onready,
    api = $bindable(null),
    class: className = '',
  }: Props = $props();

  let host: HTMLDivElement;
  let editor: VariansEditor | null = null;

  onMount(() => {
    editor = new VariansEditor(
      host,
      {
        stream,
        form,
        readonly,
        page,
        pageOrder,
        direction,
        lineNumbers,
        segmentLabels,
        pageLabels,
        tokenClasses,
        handLabel,
      },
      {
        onops: (ops, next) => onops?.(ops, next),
        onselection: (ids, caret) => onselection?.(ids, caret),
        ontokenhover: (id) => ontokenhover?.(id),
        onrequestsegment: (id, current) => onrequestsegment?.(id, current),
        oncut: (cut) => oncut?.(cut),
        oncopy: () => oncopy?.(),
        onpaste: (text) => onpaste?.(text) ?? false,
        onworddblclick: (id) => onworddblclick?.(id),
      },
    );
    api = editor;
    onready?.(editor);
    return () => {
      editor?.destroy();
      editor = null;
      api = null;
    };
  });

  $effect(() => {
    const props = {
      stream,
      form,
      readonly,
      page,
      pageOrder,
      direction,
      lineNumbers,
      segmentLabels,
      pageLabels,
      tokenClasses,
      handLabel,
    };
    untrack(() => editor?.update(props));
  });
</script>

<div class="varians-editor {className}" class:readonly bind:this={host}></div>

<style>
  .varians-editor {
    --_text: var(--color-text, var(--color-ink, #1f1d1a));
    --_muted: var(--color-muted, var(--color-ink-muted, #6f6a62));
    --_accent: var(--color-accent, #2d4b86);
    --_surface: var(--color-surface, #ffffff);
    --_rule: var(--color-line, color-mix(in srgb, var(--_muted) 28%, transparent));
    --_tint: color-mix(in srgb, var(--_accent) 10%, transparent);
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    color: var(--_text);
    background: var(--_surface);
    font-family: var(--font-serif, Georgia, 'Times New Roman', serif);
  }

  .varians-editor :global(.cm-editor) {
    height: 100%;
    min-height: 0;
    outline: none;
  }

  .varians-editor :global(.cm-scroller) {
    overflow: auto;
    font-family: inherit;
    line-height: 1.7;
  }

  .varians-editor :global(.cm-content) {
    font-size: 1.1rem;
    padding: 1rem 0 2rem;
    caret-color: var(--_accent);
  }

  .varians-editor :global(.cm-line) {
    padding: 0 1.5rem 0 0.75rem;
  }

  .varians-editor :global(.cm-cursor),
  .varians-editor :global(.cm-dropCursor) {
    border-left-color: var(--_accent);
    border-left-width: 1.5px;
  }

  /* CodeMirror's base theme paints the focused selection with a light-mode
     colour and a longer selector; these match its selectors and outrank
     them, so that selected text stays readable in dark mode too. */
  .varians-editor :global(.cm-editor > .cm-scroller > .cm-selectionLayer .cm-selectionBackground),
  .varians-editor
    :global(.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground),
  .varians-editor :global(.cm-content ::selection) {
    background: color-mix(in srgb, var(--_accent) 22%, transparent);
  }

  /* Gutters */
  .varians-editor :global(.cm-gutters) {
    background: transparent;
    border-right: none;
    color: var(--_muted);
    font-family: var(--font-sans, system-ui, sans-serif);
  }

  .varians-editor :global(.cm-segment-gutter .cm-gutterElement) {
    min-width: 3.5rem;
    padding: 0 0.5rem 0 0.75rem;
    text-align: right;
    font-size: 0.78rem;
    cursor: pointer;
  }

  .varians-editor :global(.cm-segment-gutter .cm-gutterElement:hover) {
    color: var(--_accent);
  }

  .varians-editor :global(.cm-segment-label) {
    font-weight: 500;
    color: var(--_text);
  }

  /* The segment a page's first line continues from the page before. */
  .varians-editor :global(.cm-segment-label.cm-segment-running) {
    font-weight: 400;
    font-style: italic;
    color: var(--_muted);
  }

  .varians-editor :global(.cm-lineNumbers .cm-gutterElement) {
    min-width: 2rem;
    padding: 0 0.5rem 0 0.25rem;
    font-size: 0.68rem;
    opacity: 0.45;
  }

  /* Marks */
  .varians-editor :global(.cm-mark-unclear) {
    text-decoration: underline dotted;
    text-decoration-color: var(--_muted);
    text-underline-offset: 0.22em;
  }

  .varians-editor :global(.cm-mark-supplied) {
    background: var(--_tint);
  }

  .varians-editor :global(.cm-mark-supplied::before),
  .varians-editor :global(.cm-mark-supplied::after) {
    color: var(--_muted);
    font-weight: 300;
  }

  .varians-editor :global(.cm-mark-supplied::before) {
    content: '[';
  }

  .varians-editor :global(.cm-mark-supplied::after) {
    content: ']';
  }

  .varians-editor :global(.cm-mark-del) {
    text-decoration: line-through;
    text-decoration-color: var(--_text);
  }

  .varians-editor :global(.cm-mark-add) {
    vertical-align: 0.3em;
    font-size: 0.85em;
    text-decoration: overline;
    text-decoration-thickness: 1px;
  }

  .varians-editor :global(.cm-mark-abbr) {
    text-decoration: overline dotted;
    text-decoration-color: var(--_muted);
  }

  .varians-editor :global(.cm-mark-hi) {
    color: var(--_accent);
  }

  .varians-editor :global(.cm-mark-sic::after) {
    content: 'sic';
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 0.55em;
    vertical-align: super;
    color: var(--_muted);
    margin-left: 0.15em;
  }

  .varians-editor :global(.cm-mark-damage) {
    text-decoration: underline dashed;
    text-decoration-color: var(--_muted);
    text-underline-offset: 0.22em;
    color: color-mix(in srgb, var(--_text) 70%, var(--_muted));
  }

  .varians-editor :global(.cm-mark-surplus::before) {
    content: '{';
    color: var(--_muted);
  }

  .varians-editor :global(.cm-mark-surplus::after) {
    content: '}';
    color: var(--_muted);
  }

  /* A variant noted in the carrier: a faint line under its words, a small sign after the last. */
  .varians-editor :global(.cm-mark-variant) {
    box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--_accent) 40%, transparent);
  }

  .varians-editor :global(.cm-mark-variant-end::after) {
    content: 'v.l.';
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 0.55em;
    vertical-align: super;
    line-height: 0;
    color: var(--_accent);
    opacity: 0.8;
    margin-left: 0.15em;
  }

  .varians-editor :global(.cm-unchecked) {
    text-decoration: underline wavy;
    text-decoration-color: color-mix(in srgb, var(--_muted) 55%, transparent);
    text-decoration-thickness: from-font;
    text-underline-offset: 0.3em;
  }

  .varians-editor :global(.cm-join-hyphen) {
    color: var(--_muted);
    user-select: none;
    margin-left: 0.04em;
  }

  /* Objects */
  .varians-editor :global(.cm-object) {
    display: inline-block;
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 0.68em;
    line-height: 1.2;
    padding: 0.15em 0.45em;
    border: 1px solid var(--_rule);
    border-radius: 0.3em;
    color: var(--_muted);
    vertical-align: 0.15em;
    white-space: nowrap;
  }

  .varians-editor :global(.cm-object-gap) {
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    padding: 0;
    border: none;
    vertical-align: baseline;
  }

  /* Words, not brackets: set apart from the witness's letters by their slant. */
  .varians-editor :global(.cm-object-untranscribed) {
    font-style: italic;
  }

  /* Breaks. Block widgets and lines carry no vertical margins: CodeMirror's
     height map does not see margins, and positions below would drift. */
  .varians-editor :global(.cm-break-widget) {
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 0.7rem;
    line-height: 1.4;
    letter-spacing: 0.04em;
    color: var(--_muted);
    padding: 0.9rem 1.5rem 0.3rem 0.75rem;
  }

  .varians-editor :global(.cm-break-label) {
    display: block;
    border-top: 1px solid var(--_rule);
    padding-top: 0.35rem;
  }

  /* In the whole text, a page's text stands under its label. */
  .varians-editor :global(.cm-break-page) {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--_text);
    padding-top: 1.1rem;
  }

  .varians-editor :global(.cm-break-page .cm-break-label) {
    border-top: none;
    padding-top: 0;
  }

  .varians-editor :global(.cm-break-column) {
    font-size: 0.62rem;
    padding-top: 0.5rem;
  }

  .varians-editor :global(.cm-break-column .cm-break-label) {
    border-top-style: dashed;
  }

  .varians-editor :global(.cm-paragraph-start) {
    padding-top: 0.6em;
  }

  .varians-editor :global(.cm-paragraph-start::before) {
    content: '¶';
    color: var(--_rule);
    font-size: 0.75em;
    margin-right: 0.35em;
    user-select: none;
  }

  /* Where a break would go, shown while the breaks are offered: a dashed
     rule over the line, and what would begin there. Drawn inside the line,
     so the height map is not disturbed. */
  .varians-editor :global(.cm-break-preview) {
    position: relative;
    background-image: repeating-linear-gradient(
      to right,
      var(--_accent) 0 6px,
      transparent 6px 10px
    );
    background-size: 100% 2px;
    background-repeat: no-repeat;
    background-position: top left;
  }

  .varians-editor :global(.cm-break-preview::after) {
    content: attr(data-preview);
    position: absolute;
    top: 0;
    right: 0.5rem;
    transform: translateY(-50%);
    padding: 0 0.4rem;
    border-radius: 0.25rem;
    background: var(--_accent);
    color: var(--color-accent-ink, #fff);
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 0.68rem;
    line-height: 1.5;
    pointer-events: none;
    white-space: nowrap;
  }

  /* Segment labels inside a line: raised without changing the line's height. */
  .varians-editor :global(.cm-segment-inline) {
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 0.58em;
    font-weight: 500;
    line-height: 1;
    color: var(--_accent);
    vertical-align: baseline;
    position: relative;
    top: -0.7em;
    margin-right: 0.2em;
    cursor: pointer;
    user-select: none;
  }

  /* Tooltips */
  .varians-editor :global(.cm-tooltip) {
    background: var(--_surface);
    border: 1px solid var(--_rule);
    border-radius: 0.35rem;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--_text) 12%, transparent);
    color: var(--_text);
  }

  .varians-editor :global(.cm-varians-tooltip) {
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 0.8rem;
    padding: 0.4rem 0.65rem;
    max-width: 24rem;
  }

  .varians-editor :global(.cm-varians-tooltip-row) {
    display: flex;
    gap: 0.6rem;
    justify-content: space-between;
  }

  .varians-editor :global(.cm-varians-tooltip-label) {
    color: var(--_muted);
  }

  .varians-editor :global(.cm-varians-tooltip-detail) {
    font-family: var(--font-serif, Georgia, serif);
  }

  .readonly :global(.cm-content) {
    cursor: default;
  }
</style>
