<script lang="ts">
  import Reader from '$lib/components/reader/Reader.svelte';
  import { LocalDate } from '$lib/components/ui';
  import { reader as r } from '$lib/strings/reader';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

{#if data.withdrawn}
  <!-- A withdrawn version: its citation and the withdrawal, and no text. -->
  <main class="mx-auto max-w-3xl px-4 py-8 font-sans">
    <h1 class="font-serif text-2xl">{data.withdrawn.edition.title}</h1>
    <p>
      {r.notices.withdrawnTitle(data.withdrawn.number)}.
      {r.version(data.withdrawn.number)}, {r.published}
      <LocalDate date={data.withdrawn.at} />.
    </p>
    <p>
      {r.notices.withdrawnOn(data.withdrawn.withdrawn.at.slice(0, 10))}
      {data.withdrawn.withdrawn.note ?? ''}
    </p>
    {#if data.withdrawn.current}
      <p><a href={data.withdrawn.current}>{r.notices.readCurrent}</a></p>
    {/if}
  </main>
{:else}
  <Reader {data} />
{/if}
