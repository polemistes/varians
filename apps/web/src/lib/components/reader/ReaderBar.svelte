<script lang="ts">
  /**
   * The reader's header, kept in view: the edition and the state shown,
   * search, the gear, the panels (variants, witnesses, facsimile, dictionary),
   * the menu of the published versions (and, for its editors, the draft),
   * then Edit and the edition's menu.
   */
  import Eye from '@lucide/svelte/icons/eye';
  import History from '@lucide/svelte/icons/history';
  import ImageIcon from '@lucide/svelte/icons/image';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import ScrollText from '@lucide/svelte/icons/scroll-text';
  import Split from '@lucide/svelte/icons/split';
  import {
    IconButton,
    LocalDate,
    Menu,
    MenuItem,
    MenuLabel,
    MenuSeparator,
  } from '$lib/components/ui';
  import type { ReaderSettings } from '$lib/reader/settings';
  import type { ReaderData } from '$lib/reader/types';
  import { reader as r } from '$lib/strings/reader';
  import ReaderGear from './ReaderGear.svelte';
  import ReaderSearch from './ReaderSearch.svelte';
  import EditionActions from '$lib/components/edition/EditionActions.svelte';

  interface Props {
    data: Pick<
      ReaderData,
      'edition' | 'mode' | 'versions' | 'exports' | 'links' | 'rights' | 'published'
    >;
    settings: ReaderSettings;
    onsettings: (settings: ReaderSettings) => void;
    query: string;
    hits: number;
    hit: number;
    onsearch: (query: string) => void;
    onstep: (direction: 1 | -1) => void;
    variantsOpen: boolean;
    witnessOpen: boolean;
    facsimileOpen: boolean;
    /** Present for a Greek text: the dictionary can be opened. */
    dictionaryOpen?: boolean;
    hasDictionary?: boolean;
    /** The title is shown here once the page's own title has scrolled away. */
    showTitle?: boolean;
  }

  let {
    data,
    settings,
    onsettings,
    query,
    hits,
    hit,
    onsearch,
    onstep,
    variantsOpen = $bindable(),
    witnessOpen = $bindable(),
    facsimileOpen = $bindable(),
    dictionaryOpen = $bindable(false),
    hasDictionary = false,
    showTitle = true,
  }: Props = $props();

  const shown = $derived.by(() => {
    const mode = data.mode;
    switch (mode.kind) {
      case 'published':
        return mode.number !== null ? r.version(mode.number) : r.unnumbered;
      case 'version':
        return r.version(mode.number);
      case 'draft':
        return r.draft;
      case 'preview':
        return r.notices.previewLabel;
    }
  });
</script>

<div class="reader-bar reader-bar-root">
  <div class="mx-auto flex h-12 w-full max-w-page items-center gap-1.5 px-4 sm:gap-2 sm:px-8">
    <p
      class={['min-w-0 flex-1 truncate transition-opacity duration-200', !showTitle && 'opacity-0']}
      aria-hidden={!showTitle || undefined}
    >
      <span class="font-serif text-[1.05rem] text-ink">{data.edition.title}</span>
      <span class="ml-2 hidden font-sans text-xs text-ink-muted sm:inline">{shown}</span>
    </p>
    <ReaderSearch {query} count={hits} current={hit} oninput={onsearch} {onstep} />
    <ReaderGear {settings} onchange={onsettings} />
    <IconButton
      label={r.toolbar.variants}
      aria-pressed={variantsOpen}
      class={variantsOpen ? 'bg-sunken text-ink' : ''}
      onclick={() => (variantsOpen = !variantsOpen)}
    >
      <Split aria-hidden="true" />
    </IconButton>
    <IconButton
      label={r.toolbar.witnesses}
      aria-pressed={witnessOpen}
      class={witnessOpen ? 'bg-sunken text-ink' : ''}
      onclick={() => (witnessOpen = !witnessOpen)}
    >
      <ScrollText aria-hidden="true" />
    </IconButton>
    <IconButton
      label={r.toolbar.facsimile}
      aria-pressed={facsimileOpen}
      class={facsimileOpen ? 'bg-sunken text-ink' : ''}
      onclick={() => (facsimileOpen = !facsimileOpen)}
    >
      <ImageIcon aria-hidden="true" />
    </IconButton>
    {#if hasDictionary}
      <IconButton
        label={r.toolbar.dictionary}
        aria-pressed={dictionaryOpen}
        class={dictionaryOpen ? 'bg-sunken text-ink' : ''}
        onclick={() => (dictionaryOpen = !dictionaryOpen)}
      >
        <BookOpen aria-hidden="true" />
      </IconButton>
    {/if}
    <Menu label={r.toolbar.versions} triggerSize="sm" triggerClass="px-2" class="min-w-60">
      {#snippet trigger()}
        <History class="size-4 text-ink-soft" aria-hidden="true" />
        <span class="hidden text-ink-soft md:inline">{r.toolbar.versions}</span>
      {/snippet}
      <MenuLabel>{r.menu.versions}</MenuLabel>
      {#each data.versions as version (version.number)}
        <MenuItem href={version.href}>
          <span class="flex-1"
            >{r.version(version.number)}{version.current ? ` (${r.menu.current})` : ''}</span
          >
          <LocalDate date={version.at} class="text-xs text-ink-muted" />
        </MenuItem>
      {:else}
        <MenuItem disabled>{r.menu.noVersions}</MenuItem>
      {/each}
      {#if data.links.preview || data.mode.kind === 'preview'}
        <MenuSeparator />
        {#if data.links.preview && data.mode.kind !== 'preview'}
          <MenuItem href={data.links.preview}>
            {#snippet icon()}<Eye aria-hidden="true" />{/snippet}
            {r.menu.preview}
          </MenuItem>
        {/if}
        {#if data.mode.kind === 'preview'}
          <MenuItem href={data.links.current}>
            {#snippet icon()}<Eye aria-hidden="true" />{/snippet}
            {r.menu.published}
          </MenuItem>
        {/if}
      {/if}
    </Menu>
    <EditionActions
      edition={{
        id: data.edition.id,
        slug: data.edition.slug,
        title: data.edition.title,
        published: data.published,
      }}
      rights={data.rights}
      place="reader"
      downloads={data.exports}
      class="ml-1"
    />
  </div>
</div>

<style>
  .reader-bar {
    position: sticky;
    top: 0;
    z-index: 30;
    border-bottom: 1px solid var(--color-line);
    background: color-mix(in srgb, var(--color-page) 94%, transparent);
    backdrop-filter: blur(6px);
  }

  @media print {
    .reader-bar {
      display: none;
    }
  }
</style>
