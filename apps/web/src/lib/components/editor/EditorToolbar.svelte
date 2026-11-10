<script lang="ts">
  /**
   * The editor's commands as plain buttons. The parent decides where the
   * toolbar stands (under a selection, above the text) and when it shows.
   */
  import type { EditorApi } from '$lib/editor/editor';
  import { markButtonLabels, toolbarStrings as t } from '$lib/editor/labels';

  interface Props {
    api: EditorApi | null;
    visible?: boolean;
    /** Show the objects and breaks, made at the caret. Off where a menu of its own offers them. */
    inserts?: boolean;
    /** Show "Segment here". Off where the host offers Segment… itself. */
    segments?: boolean;
    class?: string;
  }

  let {
    api,
    visible = true,
    inserts = true,
    segments = true,
    class: className = '',
  }: Props = $props();

  const markKinds = ['unclear', 'supplied', 'del', 'add', 'abbr', 'hi', 'sic', 'damage', 'surplus'];

  /** Keep the editor's focus and selection when a button is pressed. */
  function keepFocus(event: Event) {
    event.preventDefault();
  }

  function title(label: string, shortcut?: string): string {
    return shortcut ? `${label} (${shortcut})` : label;
  }
</script>

{#if visible}
  <div class="editor-toolbar {className}" role="toolbar">
    <div class="group" role="group" aria-label={t.marks}>
      {#each markKinds as kind (kind)}
        <button
          type="button"
          title={title(markButtonLabels[kind] ?? kind, t.shortcuts[kind])}
          onpointerdown={keepFocus}
          onclick={() => api?.toggleMark(kind)}
        >
          {markButtonLabels[kind] ?? kind}
        </button>
      {/each}
    </div>
    {#if inserts}
      <div class="group" role="group" aria-label={t.objects}>
        <button
          type="button"
          title={title(t.gap, t.shortcuts.gap)}
          onpointerdown={keepFocus}
          onclick={() => api?.insertObject('gap', { reason: 'lost' })}
        >
          {t.gap}
        </button>
        <button type="button" onpointerdown={keepFocus} onclick={() => api?.insertObject('space')}
          >{t.space}</button
        >
        <button type="button" onpointerdown={keepFocus} onclick={() => api?.insertObject('figure')}
          >{t.figure}</button
        >
        <button type="button" onpointerdown={keepFocus} onclick={() => api?.insertObject('note')}
          >{t.note}</button
        >
      </div>
      <div class="group" role="group" aria-label={t.breaks}>
        <button type="button" onpointerdown={keepFocus} onclick={() => api?.insertBreak('column')}
          >{t.columnBreak}</button
        >
        <button
          type="button"
          onpointerdown={keepFocus}
          onclick={() => api?.insertBreak('paragraph')}>{t.paragraph}</button
        >
      </div>
    {/if}
    <div class="group" role="group" aria-label={t.structure}>
      <button
        type="button"
        title={t.joinTitle}
        onpointerdown={keepFocus}
        onclick={() => api?.setJoinAtCaret()}
      >
        {t.join}
      </button>
      {#if segments}
        <button
          type="button"
          title={title(t.segmentTitle, t.shortcuts.segment)}
          onpointerdown={keepFocus}
          onclick={() => api?.requestSegmentAtCaret()}
        >
          {t.segment}
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .editor-toolbar {
    --_text: var(--color-text, var(--color-ink, #1f1d1a));
    --_muted: var(--color-muted, var(--color-ink-muted, #6f6a62));
    --_accent: var(--color-accent, #2d4b86);
    --_surface: var(--color-surface, #ffffff);
    --_rule: var(--color-line, color-mix(in srgb, var(--_muted) 28%, transparent));
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    padding: 0.35rem 0.5rem;
    background: var(--_surface);
    border: 1px solid var(--_rule);
    border-radius: 0.4rem;
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 0.78rem;
    color: var(--_text);
  }

  .group {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem;
  }

  .group + .group {
    border-left: 1px solid var(--_rule);
    padding-left: 0.75rem;
  }

  button {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 0.3rem;
    background: transparent;
    color: inherit;
    font: inherit;
    padding: 0.2rem 0.5rem;
    cursor: pointer;
    line-height: 1.3;
  }

  button:hover {
    background: color-mix(in srgb, var(--_accent) 10%, transparent);
  }

  button:focus-visible {
    outline: 2px solid var(--_accent);
    outline-offset: 1px;
  }
</style>
