<script lang="ts">
  /** A version of an edition in the reader; a withdrawn one, its citation and the withdrawal. */
  import { page } from '$app/state';
  import Reader from '$lib/components/reader/Reader.svelte';
  import WithdrawnVersion from '$lib/components/version/WithdrawnVersion.svelte';
  import { versionCitation } from '$lib/reader/citation';
  import { and } from '$lib/strings/names';
  import { reader as r } from '$lib/strings/reader';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

{#if data.withdrawn}
  {@const w = data.withdrawn}
  <WithdrawnVersion
    kicker={r.authorAndWork(w.work.author, w.work.title)}
    title={w.edition.title}
    byline={w.edition.editors.length ? r.editedBy(and(w.edition.editors)) : null}
    number={w.number}
    at={w.at}
    note={w.note}
    withdrawn={w.withdrawn}
    citation={versionCitation({
      editors: w.edition.editors,
      title: w.edition.title,
      number: w.number,
      at: w.at,
      address: `${page.url.origin}/editions/${encodeURIComponent(w.edition.slug)}/v/${w.number}`,
      licence: w.licence,
    })}
    current={w.current}
    versions={w.versions}
  />
{:else}
  <Reader {data} />
{/if}
