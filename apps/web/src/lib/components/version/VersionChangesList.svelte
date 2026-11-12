<script lang="ts">
  /**
   * The changes since the version before, as Publish… and What Changed show
   * them: the totals of words added, changed and removed, always in view, and
   * opened under them what the history says of itself (an import, a copy,
   * pages reorganized) and the words by segment.
   */
  import type { VersionChanges } from '@varians/db';
  import { LocalDate } from '$lib/components/ui';
  import { versions as v } from '$lib/strings/versions';

  interface Props {
    changes: VersionChanges;
    /** Shown open from the start. */
    open?: boolean;
  }

  let { changes, open = false }: Props = $props();
  const c = v.changes;
</script>

<details class="version-changes rounded-md border border-line font-sans text-sm" {open}>
  <summary class="cursor-pointer px-3 py-2 text-ink select-none"
    >{c.totals(changes.added, changes.changed, changes.removed)}</summary
  >
  <div class="border-t border-line px-3 py-2">
    {#if changes.described.length}
      <ul class="mb-2 space-y-0.5 text-ink-soft">
        {#each changes.described as line, i (i)}
          <li>{line.message} <LocalDate date={line.at} class="text-xs text-ink-muted" /></li>
        {/each}
      </ul>
    {/if}
    {#if changes.segments.length}
      <table class="w-full text-left tabular-nums">
        <thead class="text-xs text-ink-muted">
          <tr>
            <th scope="col" class="py-1 font-medium">{c.segment}</th>
            <th scope="col" class="py-1 text-right font-medium">{c.added}</th>
            <th scope="col" class="py-1 text-right font-medium">{c.changed}</th>
            <th scope="col" class="py-1 text-right font-medium">{c.removed}</th>
          </tr>
        </thead>
        <tbody>
          {#each changes.segments as row, i (row.segmentId ?? `none-${i}`)}
            <tr class="border-t border-line/60">
              <th scope="row" class="py-1 font-normal text-ink">{row.label ?? c.noSegment}</th>
              <td class="py-1 text-right">{row.added}</td>
              <td class="py-1 text-right">{row.changed}</td>
              <td class="py-1 text-right">{row.removed}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="text-ink-soft">{c.none}</p>
    {/if}
  </div>
</details>

<style>
  .version-changes table {
    border-collapse: collapse;
  }
</style>
