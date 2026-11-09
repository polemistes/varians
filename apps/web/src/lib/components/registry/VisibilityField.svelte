<script lang="ts">
  import { registry } from '$lib/strings/registry';
  import type { WorkVisibility } from '$lib/registry/types';

  interface Props {
    value?: WorkVisibility;
    name?: string;
    /** Hide the legend where a heading already says it (it stays for screen readers). */
    quietLegend?: boolean;
  }

  let { value = 'public', name = 'visibility', quietLegend = false }: Props = $props();

  const s = registry.work;
  const choices: { value: WorkVisibility; label: string; hint: string }[] = [
    { value: 'public', label: s.public, hint: s.publicHint },
    { value: 'private', label: s.private, hint: s.privateHint },
  ];
</script>

<fieldset class="flex flex-col gap-3 font-sans">
  <legend class={quietLegend ? 'sr-only' : 'mb-2 text-sm font-medium text-ink'}
    >{s.visibility}</legend
  >
  {#each choices as choice (choice.value)}
    <label class="flex cursor-pointer items-start gap-2.5">
      <input
        type="radio"
        {name}
        value={choice.value}
        checked={value === choice.value}
        class="mt-0.5 size-4 shrink-0 accent-accent"
      />
      <span class="flex flex-col">
        <span class="text-sm text-ink">{choice.label}</span>
        <span class="text-xs text-ink-soft">{choice.hint}</span>
      </span>
    </label>
  {/each}
</fieldset>
