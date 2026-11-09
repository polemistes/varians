<script lang="ts">
  /**
   * Merging a work or witness into another: the surviving entry chosen by
   * search, then the preview of what moves and what prevents the merge, and
   * the merge itself.
   */
  import { PageFrame } from '$lib/components/shell';
  import { Button, Field, Input, Notice } from '$lib/components/ui';
  import type { MergePreview } from '$lib/registry/merge';
  import { registry as t } from '$lib/strings/registry';
  import FormSection from './FormSection.svelte';

  interface Props {
    data: {
      kind: 'work' | 'witness';
      entry: { id: string; slug: string; name: string };
      q: string;
      hits: { id: string; slug: string; title: string; detail: string }[];
      preview: MergePreview | null;
      allowed: boolean;
      blocked: boolean;
    };
    error?: string | null;
  }

  let { data, error = null }: Props = $props();
  const s = t.merge;

  const chooseHref = (slug: string) => `?${new URLSearchParams({ q: data.q, into: slug }).toString()}`;

  /** What moves, in words, leaving out what is nothing. */
  const moves = $derived.by(() => {
    const p = data.preview;
    if (!p) return [];
    const out: string[] = [];
    if (p.kind === 'witness') {
      if (p.moves.transcriptions) out.push(s.transcriptions(p.moves.transcriptions));
      if (p.moves.readings) out.push(s.readings(p.moves.readings));
      if (p.moves.sigla.length) out.push(s.sigla(p.moves.sigla));
      if (p.moves.pages) out.push(s.pages(p.moves.pages));
      if (p.moves.hands.length) out.push(s.hands(p.moves.hands));
    } else {
      if (p.moves.segmentsMatched) out.push(s.segmentsMatched(p.moves.segmentsMatched));
      if (p.moves.segmentsMoved) out.push(s.segmentsMoved(p.moves.segmentsMoved));
      if (p.moves.conjectures) out.push(s.conjectures(p.moves.conjectures));
      if (p.moves.readings) out.push(s.readings(p.moves.readings));
      if (p.moves.editions.length) out.push(s.editions(p.moves.editions));
      if (p.moves.transcriptions) out.push(s.transcriptions(p.moves.transcriptions));
    }
    if (p.moves.maintainers.length) out.push(s.maintainers(p.moves.maintainers));
    if (p.moves.identifiers.length) out.push(s.identifiers(p.moves.identifiers));
    return out;
  });

  const blocks = $derived.by(() => {
    const p = data.preview;
    if (!p) return [];
    if (p.kind === 'witness') {
      return [
        ...(p.blocks.bothInEdition.length ? [s.bothInEdition(p.blocks.bothInEdition)] : []),
        ...(p.blocks.pageConflicts.length ? [s.pageConflict(p.blocks.pageConflicts)] : []),
      ];
    }
    return [
      ...(p.blocks.schemeDiffers ? [s.schemeDiffers] : []),
      ...(p.blocks.labelCollisions.length ? [s.labelCollision(p.blocks.labelCollisions)] : []),
    ];
  });
</script>

<PageFrame title={s.title(data.entry.name)} width="page">
  <FormSection title={s.survivor}>
    <form method="get" class="flex flex-col gap-3">
      <Field label={data.kind === 'work' ? s.findWork : s.findWitness}>
        {#snippet children(control)}
          <div class="flex gap-2">
            <Input {...control} name="q" value={data.q} autocomplete="off" spellcheck="false" class="min-w-0 flex-1" />
            <Button type="submit" variant="secondary">{s.find}</Button>
          </div>
        {/snippet}
      </Field>
    </form>
    {#if data.q}
      {#if data.hits.length}
        <ul class="mt-4 divide-y divide-line rounded-md border border-line bg-surface font-sans text-sm" data-testid="merge-hits">
          {#each data.hits as hit (hit.id)}
            <li class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-2.5">
              <span class="min-w-0">
                <span class="font-serif text-base text-ink">{hit.title}</span>{#if hit.detail}<span class="text-ink-soft">, {hit.detail}</span>{/if}
              </span>
              <a href={chooseHref(hit.slug)} class="text-accent underline-offset-2 hover:underline" aria-label={s.chooseLabel(hit.title)}>{s.choose}</a>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="mt-4 font-sans text-sm text-ink-soft">{s.noMatches}</p>
      {/if}
    {/if}
  </FormSection>

  {#if data.preview}
    {@const p = data.preview}
    <FormSection title={s.preview(p.from.name, p.into.name)}>
      <div class="flex flex-col gap-6 font-sans text-sm" data-testid="merge-preview">
        <p class="text-ink-soft">{s.survivorKeeps}</p>
        <div>
          <h3 class="font-medium text-ink">{s.moves}</h3>
          {#if moves.length}
            <ul class="mt-2 list-disc space-y-1 pl-5 text-ink">
              {#each moves as line (line)}<li>{line}</li>{/each}
            </ul>
          {:else}
            <p class="mt-2 text-ink-soft">{s.nothingMoves}</p>
          {/if}
        </div>
        {#if blocks.length}
          <div>
            <h3 class="font-medium text-ink">{s.blocks}</h3>
            <ul class="mt-2 list-disc space-y-1 pl-5 text-ink" data-testid="merge-blocks">
              {#each blocks as line (line)}<li>{line}</li>{/each}
            </ul>
          </div>
        {/if}
        {#if !data.allowed}
          <Notice kind="warning">{s.notAllowed}</Notice>
        {:else if !data.blocked}
          <form method="post" action="?/merge" class="flex flex-col gap-3">
            <input type="hidden" name="intoId" value={p.into.id} />
            <p class="text-ink-soft">{s.irreversible}</p>
            <div><Button type="submit" variant="danger">{s.confirm}</Button></div>
          </form>
        {/if}
        {#if error}<Notice kind="error">{error}</Notice>{/if}
      </div>
    </FormSection>
  {:else if error}
    <Notice kind="error">{error}</Notice>
  {/if}
</PageFrame>
