<script lang="ts">
  /**
   * A window for choosing a language. With `list`, the languages already in
   * the text, those Varians names and Other…, nothing chosen to begin with;
   * without it, only a field for a BCP 47 tag. Choose gives the language;
   * closing the window otherwise cancels.
   */
  import { Button, Dialog, Field, Input } from '$lib/components/ui';
  import { LANGUAGE_CODE, LANGUAGES, languageName } from '$lib/registry/languages';
  import { editor } from '$lib/strings/editor';

  const t = editor.language;
  const OTHER = '';

  interface Props {
    open?: boolean;
    /** Offer the list of languages; otherwise only the field for a tag. */
    list?: boolean;
    /** The sentence under the title. */
    description?: string;
    /** The languages already in the text, in the order they first occur. */
    inText?: string[];
    onchoose: (lang: string) => void;
    oncancel?: () => void;
  }

  let {
    open = $bindable(false),
    list = false,
    description,
    inText = [],
    onchoose,
    oncancel,
  }: Props = $props();

  const uid = $props.id();
  const formId = `language-${uid}`;
  /** The choice: a language tag, OTHER for one typed, null for none yet. */
  let choice = $state<string | null>(null);
  let code = $state('');
  let error = $state<string | null>(null);
  let chosen = false;

  $effect(() => {
    if (!open) return;
    choice = list ? null : OTHER;
    code = '';
    error = null;
    chosen = false;
  });

  const typing = $derived(choice === OTHER);
  const ready = $derived(choice !== null && (!typing || code.trim() !== ''));

  function submit(event: Event) {
    event.preventDefault();
    if (choice === null) return;
    const lang = typing ? code.trim() : choice;
    if (!LANGUAGE_CODE.test(lang)) {
      error = t.codeInvalid;
      return;
    }
    chosen = true;
    open = false;
    onchoose(lang);
  }

  function onOpenChange(next: boolean) {
    if (!next && !chosen) oncancel?.();
  }

  function close() {
    open = false;
    if (!chosen) oncancel?.();
  }

  const optionClass =
    'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-sunken has-checked:bg-sunken';
</script>

<Dialog bind:open title={t.label} {description} size="sm" {onOpenChange}>
  <form id={formId} class="flex flex-col gap-3" onsubmit={submit}>
    {#if list}
      <div class="flex flex-col" role="radiogroup" aria-label={t.label}>
        {#each inText as lang (lang)}
          <label class={optionClass}>
            <input type="radio" name="{formId}-choice" value={lang} bind:group={choice} />
            <span class="flex-1">{languageName(lang)}</span>
            <span class="font-mono text-xs text-ink-muted">{lang}</span>
          </label>
        {/each}
        {#if inText.length}<hr class="my-1 border-line" />{/if}
        {#each LANGUAGES as language (language.code)}
          <label class={optionClass}>
            <input type="radio" name="{formId}-choice" value={language.code} bind:group={choice} />
            <span class="flex-1">{language.name}</span>
            <span class="font-mono text-xs text-ink-muted">{language.code}</span>
          </label>
        {/each}
        <label class={optionClass}>
          <input type="radio" name="{formId}-choice" value={OTHER} bind:group={choice} />
          <span class="flex-1">{t.other}</span>
        </label>
      </div>
    {/if}
    {#if typing}
      <Field label={t.code} hint={t.codeHint} {error}>
        {#snippet children(control)}
          <Input
            {...control}
            bind:value={code}
            autocomplete="off"
            spellcheck="false"
            class="w-48 font-mono text-xs"
            oninput={() => (error = null)}
          />
        {/snippet}
      </Field>
    {/if}
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={close}>{t.cancel}</Button>
    <Button type="submit" form={formId} variant="primary" disabled={!ready}>{t.choose}</Button>
  {/snippet}
</Dialog>
