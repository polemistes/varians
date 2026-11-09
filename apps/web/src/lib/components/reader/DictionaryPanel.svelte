<script lang="ts">
  /**
   * The dictionary beside the text: the analyses of a word (each form with
   * its lemma and grammar, from the treebanks and Morpheus) and the entries
   * of the lemma chosen, each with the dictionary it is from and its licence.
   * The word is the one last clicked in the text, or one typed here.
   */
  import X from '@lucide/svelte/icons/x';
  import { Input, Spinner } from '$lib/components/ui';
  import { reader as r } from '$lib/strings/reader';

  interface Analysis {
    form: string;
    lemma: string;
    postag: string;
    description: string;
    source: string;
  }

  interface Entry {
    lexicon: { id: string; title: string; licence: string };
    headword: string;
    homograph: number;
    html: string;
  }

  interface Props {
    /** The word to look up: the one clicked in the text. */
    word: string | null;
    onclose: () => void;
  }

  let { word, onclose }: Props = $props();

  const t = r.panels.dictionary;

  let typed = $state('');
  let shown = $state<string | null>(null);
  let analyses = $state<Analysis[] | null>(null);
  let lemma = $state<string | null>(null);
  let entries = $state<Entry[] | null>(null);
  let failed = $state(false);

  // A word clicked in the text replaces what was typed.
  $effect(() => {
    if (word) {
      typed = word;
      void look(word);
    }
  });

  /** The analyses grouped by lemma, in the order they come (treebank first). */
  const byLemma = $derived.by(() => {
    const groups = new Map<string, Analysis[]>();
    for (const a of analyses ?? []) groups.set(a.lemma, [...(groups.get(a.lemma) ?? []), a]);
    return [...groups].map(([l, list]) => ({ lemma: l, list }));
  });

  async function look(value: string) {
    const w = value.trim();
    if (!w) return;
    shown = w;
    analyses = null;
    entries = null;
    lemma = null;
    failed = false;
    try {
      const response = await fetch(`/api/greek/words?w=${encodeURIComponent(w)}`);
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { words: Record<string, Analysis[]> };
      if (shown !== w) return;
      analyses = data.words[w] ?? [];
      const first = analyses[0]?.lemma;
      await open(first ?? w);
    } catch {
      if (shown === w) failed = true;
    }
  }

  async function open(value: string) {
    lemma = value;
    entries = null;
    try {
      const response = await fetch(`/api/greek/entries?lemma=${encodeURIComponent(value)}`);
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { entries: Entry[] };
      if (lemma === value) entries = data.entries;
    } catch {
      if (lemma === value) entries = [];
    }
  }
</script>

<section class="panel" aria-labelledby="dictionary-panel-title">
  <header class="panel-header">
    <h2 id="dictionary-panel-title" class="panel-title">{t.title}</h2>
    <button type="button" class="panel-close" aria-label={r.panels.close(r.toolbar.dictionary)} title={r.panels.close(r.toolbar.dictionary)} onclick={onclose}>
      <X class="size-4" aria-hidden="true" />
    </button>
  </header>

  <form
    class="search"
    onsubmit={(event) => {
      event.preventDefault();
      void look(typed);
    }}
  >
    <Input bind:value={typed} placeholder={t.placeholder} aria-label={t.placeholder} lang="grc" autocomplete="off" spellcheck="false" />
  </form>

  <div class="body" lang="en">
    {#if !shown}
      <p class="notice">{t.prompt}</p>
    {:else if failed}
      <p class="notice">{t.failed}</p>
    {:else if analyses === null}
      <p class="notice"><Spinner size="sm" /> {t.loading}</p>
    {:else}
      {#if byLemma.length === 0}
        <p class="notice">{t.noAnalysis(shown)}</p>
      {:else}
        <ul class="analyses">
          {#each byLemma as group (group.lemma)}
            <li>
              <button type="button" class={['lemma', group.lemma === lemma && 'chosen']} lang="grc" onclick={() => void open(group.lemma)} aria-pressed={group.lemma === lemma}>
                {group.lemma}
              </button>
              <ul class="forms">
                {#each group.list as a (a.form + a.postag)}
                  <li><span class="form" lang="grc">{a.form}</span> <span class="parse">{a.description}</span></li>
                {/each}
              </ul>
            </li>
          {/each}
        </ul>
      {/if}
      {#if entries === null && lemma}
        <p class="notice"><Spinner size="sm" /> {t.loading}</p>
      {:else if entries && entries.length === 0 && lemma}
        <p class="notice">{t.noEntry(lemma)}</p>
      {:else if entries}
        {#each entries as entry (entry.lexicon.id + entry.headword + entry.homograph)}
          <article class="entry">
            <div class="entry-text" lang="grc">{@html entry.html}</div>
            <p class="entry-source">{t.from(entry.lexicon.title, entry.lexicon.licence)}</p>
          </article>
        {/each}
      {/if}
    {/if}
  </div>
</section>

<style>
  .panel {
    border: 1px solid var(--color-line);
    border-radius: 0.5rem;
    background: var(--color-surface);
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem 0.5rem 1rem;
  }

  .panel-title {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }

  .panel-close {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.375rem;
    color: var(--color-ink-muted);
  }

  .panel-close:hover {
    background: var(--color-sunken);
    color: var(--color-ink);
  }

  .search {
    padding: 0 1rem 0.5rem;
  }

  .body {
    max-height: min(36rem, 60dvh);
    overflow-y: auto;
    border-top: 1px solid var(--color-line);
    padding: 0.5rem 1rem 1rem;
    font-size: 0.875rem;
  }

  .notice {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--color-ink-muted);
  }

  .analyses {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .lemma {
    font-family: var(--font-serif);
    font-size: 1.05rem;
    color: var(--color-ink);
    border-radius: 0.25rem;
    padding: 0 0.25rem;
  }

  .lemma:hover,
  .lemma.chosen {
    background: var(--color-sunken);
  }

  .forms {
    margin-left: 0.75rem;
    color: var(--color-ink-soft);
  }

  .form {
    font-family: var(--font-serif);
    color: var(--color-ink);
  }

  .entry {
    margin-top: 0.75rem;
    border-top: 1px solid var(--color-line);
    padding-top: 0.5rem;
  }

  .entry-text {
    font-family: var(--font-serif);
    line-height: 1.5;
    color: var(--color-ink);
  }

  .entry-text :global(p + p) {
    margin-top: 0.4rem;
  }

  .entry-source {
    margin-top: 0.4rem;
    font-size: 0.75rem;
    color: var(--color-ink-muted);
  }
</style>
