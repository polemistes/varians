<script lang="ts">
  /**
   * The foot of the page: the downloads of the state shown and the published
   * versions, as plain links that work without scripts.
   */
  import { LocalDate } from '$lib/components/ui';
  import type { ReaderData } from '$lib/reader/types';
  import { and } from '$lib/strings/names';
  import { reader as r } from '$lib/strings/reader';

  interface Props {
    exports: ReaderData['exports'];
    versions: ReaderData['versions'];
    /** The edition this one was copied from. */
    origin?: ReaderData['origin'];
    /** The edition's own sources and licence. */
    sources?: string | null;
    licence?: string | null;
  }

  let { exports, versions, origin = null, sources = null, licence = null }: Props = $props();
</script>

<footer class="colophon">
  <h2 class="font-sans text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">{r.colophon.title}</h2>
  {#if origin}
    <p class="mt-2">
      {r.colophon.copiedFrom}
      {#if origin.href}<a href={origin.href}><i>{origin.title}</i></a>{:else}<i>{origin.title}</i>{/if}{origin.editors.length ? `, ${r.colophon.editedBy(and(origin.editors))}` : ''},
      {origin.number !== null ? r.colophon.copiedVersion(origin.number) : r.colophon.copiedDraft}.
    </p>
  {/if}
  <p class="mt-2">
    {r.colophon.downloads}:
    <a href={exports.text} data-sveltekit-reload>{r.menu.plainText}</a>
    <span class="text-ink-muted" aria-hidden="true">·</span>
    <a href={exports.tei} data-sveltekit-reload>{r.menu.tei}</a>
  </p>
  {#if versions.length}
    <p class="mt-1">
      {r.colophon.versions}:
      {#each versions as version, k (version.number)}{k > 0 ? ', ' : ''}<a href={version.href}>{r.version(version.number)}</a>
        (<LocalDate date={version.at} />{version.current ? `, ${r.colophon.current}` : ''}){/each}
    </p>
  {/if}
  {#if sources}
    <p class="mt-2 whitespace-pre-line">{r.colophon.sources}: {sources}</p>
  {/if}
  {#if licence}
    <p class="mt-1">{r.colophon.licence}: {licence}</p>
  {/if}
  <p class="mt-2"><a href="/sources">{r.colophon.usedByVarians}</a></p>
</footer>

<style>
  .colophon {
    margin-top: 4rem;
    border-top: 1px solid var(--color-line);
    padding-top: 1.25rem;
    font-family: var(--font-sans);
    font-size: 0.8125rem;
    color: var(--color-ink-soft);
  }

  .colophon a {
    color: var(--color-accent);
  }

  .colophon a:hover {
    text-decoration: underline;
  }

  @media print {
    .colophon {
      display: none;
    }
  }
</style>
