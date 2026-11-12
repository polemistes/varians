<script lang="ts">
  /**
   * Language, above the text of an editor: its button names the language in
   * force at the caret, and is empty where none is. The menu lists the
   * languages already in the text in the order they first occur, then those
   * Varians names, then Other…, which asks for a BCP 47 tag. Choosing gives
   * the selected words the language, or, with none selected, what is typed
   * next. The chooser that a word typed where no language is in force opens
   * is here too, with the same list and nothing chosen.
   */
  import { DropdownMenu } from 'bits-ui';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { LANGUAGES, languageName } from '$lib/registry/languages';
  import { editor } from '$lib/strings/editor';
  import LanguageDialog from './LanguageDialog.svelte';
  import type { EditorLanguage } from './language.svelte';

  const t = editor.language;

  interface Props {
    language: EditorLanguage;
    /** Where the menu opens from its button. */
    align?: 'start' | 'end';
  }

  let { language, align = 'start' }: Props = $props();

  let menuOpen = $state(false);
  /** The languages in the text, read when the menu or a window opens. */
  let inText = $state<string[]>([]);

  $effect(() => {
    if (menuOpen || language.asking) inText = language.inText;
  });

  const itemClass =
    'flex w-full cursor-default items-center gap-2 rounded px-2 py-1.5 text-left text-ink outline-none select-none data-highlighted:bg-sunken';
</script>

<DropdownMenu.Root bind:open={menuOpen}>
  <DropdownMenu.Trigger
    class="inline-flex h-8 min-w-20 items-center justify-between gap-1 rounded-md px-2 text-sm text-ink hover:bg-sunken data-[state=open]:bg-sunken"
    aria-label={t.label}
    title={t.label}
    data-language-control
  >
    <span class="max-w-40 truncate">{language.current ? languageName(language.current) : ''}</span>
    <ChevronDown class="size-3.5 text-ink-muted" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      {align}
      sideOffset={6}
      class="z-50 max-h-[70vh] min-w-56 overflow-y-auto rounded-md border border-line bg-surface p-1 font-sans text-sm shadow-pop outline-none animate-fade-in"
      onCloseAutoFocus={(event) => {
        // Back to the text, with the caret and the selection where they were.
        event.preventDefault();
        if (!language.otherOpen) language.focus();
      }}
    >
      {#each inText as lang (lang)}
        <DropdownMenu.Item class={itemClass} onSelect={() => language.choose(lang)}>
          <span class="flex-1">{languageName(lang)}</span>
          <span class="font-mono text-xs text-ink-muted">{lang}</span>
          {#if language.current === lang}<span class="text-accent" aria-hidden="true">●</span>{/if}
        </DropdownMenu.Item>
      {/each}
      {#if inText.length}<DropdownMenu.Separator class="my-1 h-px bg-line" />{/if}
      {#each LANGUAGES as named (named.code)}
        <DropdownMenu.Item class={itemClass} onSelect={() => language.choose(named.code)}>
          <span class="flex-1">{named.name}</span>
          <span class="font-mono text-xs text-ink-muted">{named.code}</span>
        </DropdownMenu.Item>
      {/each}
      <DropdownMenu.Separator class="my-1 h-px bg-line" />
      <DropdownMenu.Item class={itemClass} onSelect={() => (language.otherOpen = true)}>
        <span class="flex-1">{t.other}</span>
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>

<LanguageDialog
  bind:open={language.otherOpen}
  onchoose={(lang) => {
    language.choose(lang);
    language.focus();
  }}
  oncancel={() => language.focus()}
/>

<!-- The chooser closes by its answer or its cancelling, which the language hears through the handlers. -->
<LanguageDialog
  bind:open={() => language.asking, () => {}}
  list
  description={t.ask}
  {inText}
  onchoose={(lang) => language.answer(lang)}
  oncancel={() => language.cancel()}
/>
