<script lang="ts">
  import { registry } from '$lib/strings/registry';

  interface Props {
    /** Segments the transcription has. */
    n: number;
    /** Segments the work has. */
    total: number;
    class?: string;
  }

  let { n, total, class: className }: Props = $props();

  const share = $derived(total > 0 ? Math.min(1, n / total) : 0);
</script>

<div class={['flex items-center gap-2 font-sans text-xs text-ink-soft', className]}>
  <div
    role="meter"
    aria-label={registry.work.coverageTitle}
    aria-valuemin={0}
    aria-valuemax={total}
    aria-valuenow={n}
    aria-valuetext={registry.work.coverageLabel(n, total)}
    class="h-1.5 w-20 overflow-hidden rounded-full bg-sunken ring-1 ring-line ring-inset"
  >
    <div class="h-full rounded-full bg-accent/70" style:width="{Math.round(share * 100)}%"></div>
  </div>
  <span class="min-w-32 whitespace-nowrap tabular-nums" aria-hidden="true">{registry.work.coverage(n, total)}</span>
</div>
