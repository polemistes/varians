<script lang="ts">
  /** A version of a transcription, in the workbench read only; a withdrawn one, its citation and the withdrawal. */
  import { page } from '$app/state';
  import Workbench from '../../+page.svelte';
  import WithdrawnVersion from '$lib/components/version/WithdrawnVersion.svelte';
  import { versionCitation } from '$lib/reader/citation';
  import { registry } from '$lib/strings/registry';
  import { versions as v } from '$lib/strings/versions';
  import type { PageProps } from './$types';

  let { data, params }: PageProps = $props();
</script>

{#if data.withdrawn}
  {@const w = data.withdrawn}
  {@const editors = w.personName ? [w.personName] : []}
  <WithdrawnVersion
    kicker={v.withdrawnPage.witness(w.witness.siglum, w.witness.name)}
    title={w.transcription.name}
    byline={w.personName ? registry.transcription.owner(w.personName) : null}
    number={w.number}
    at={w.at}
    note={w.note}
    withdrawn={w.withdrawn}
    citation={versionCitation({
      editors,
      title: v.withdrawnPage.transcript(w.witness.name, w.transcription.name),
      number: w.number,
      at: w.at,
      address: `${page.url.origin}/transcriptions/${encodeURIComponent(w.transcription.id)}/v/${w.number}`,
      licence: w.licence,
    })}
    current={w.current}
    versions={w.versions}
  />
{:else}
  <Workbench {data} {params} form={null} />
{/if}
