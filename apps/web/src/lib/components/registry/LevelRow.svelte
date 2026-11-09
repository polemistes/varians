<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import X from '@lucide/svelte/icons/x';
  import type { Level, LevelType } from '@varians/core';
  import { Field, IconButton, Input, Select } from '$lib/components/ui';
  import { LEVEL_TYPES, SEPARATOR_VALUES } from '$lib/registry/scheme';
  import { registry } from '$lib/strings/registry';

  interface Props {
    level: Level;
    index: number;
    count: number;
    /** Keys and types fixed, and no levels added or removed: the work has segments. */
    locked?: boolean;
    onchange: (patch: Partial<Level>) => void;
    onmove: (by: -1 | 1) => void;
    onremove: () => void;
  }

  let { level, index, count, locked = false, onchange, onmove, onremove }: Props = $props();

  const s = registry.scheme;
  const uid = $props.id();
  const headingId = `level-${uid}`;
  const n = $derived(index + 1);

  const typeOptions = LEVEL_TYPES.map((type) => ({
    value: type,
    label: type === 'number' ? s.number : s.text,
  }));
  const separatorOptions = SEPARATOR_VALUES.map((value) => ({
    value,
    label: value.trim() ? `${s.separators[value]} ( ${value} )` : (s.separators[value] ?? value),
  }));
</script>

<div role="group" aria-labelledby={headingId} class="rounded-md border border-line bg-surface p-4">
  <div class="mb-3 flex items-center justify-between gap-3">
    <h3 id={headingId} class="font-sans text-sm font-medium text-ink">{s.level(n)}</h3>
    {#if !locked}
      <div class="flex items-center gap-0.5">
        <IconButton
          size="sm"
          label={`${s.moveUp}: ${s.level(n)}`}
          disabled={index === 0}
          onclick={() => onmove(-1)}
        >
          <ArrowUp aria-hidden="true" />
        </IconButton>
        <IconButton
          size="sm"
          label={`${s.moveDown}: ${s.level(n)}`}
          disabled={index === count - 1}
          onclick={() => onmove(1)}
        >
          <ArrowDown aria-hidden="true" />
        </IconButton>
        <IconButton
          size="sm"
          label={`${s.removeLevel}: ${s.level(n)}`}
          disabled={count === 1}
          onclick={onremove}
        >
          <X aria-hidden="true" />
        </IconButton>
      </div>
    {/if}
  </div>
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <Field label={s.label}>
      {#snippet children(control)}
        <Input
          {...control}
          value={level.label}
          oninput={(e) => onchange({ label: e.currentTarget.value })}
          autocomplete="off"
        />
      {/snippet}
    </Field>
    <Field label={s.key}>
      {#snippet children(control)}
        <Input
          {...control}
          value={level.key}
          oninput={(e) => onchange({ key: e.currentTarget.value })}
          readonly={locked}
          title={locked ? s.locked : undefined}
          autocomplete="off"
          spellcheck="false"
          class="font-mono text-xs read-only:bg-sunken read-only:text-ink-soft"
        />
      {/snippet}
    </Field>
    <Field label={s.type}>
      {#snippet children(control)}
        <Select
          {...control}
          value={level.type}
          options={typeOptions}
          disabled={locked}
          title={locked ? s.locked : undefined}
          onchange={(e) => onchange({ type: e.currentTarget.value as LevelType })}
        />
      {/snippet}
    </Field>
    {#if index > 0}
      <Field label={s.separator}>
        {#snippet children(control)}
          <Select
            {...control}
            value={level.separator}
            options={separatorOptions}
            onchange={(e) => onchange({ separator: e.currentTarget.value })}
          />
        {/snippet}
      </Field>
    {:else}
      <div class="flex flex-col gap-1.5 font-sans">
        <span class="text-sm font-medium text-ink-muted">{s.separator}</span>
        <span class="flex h-9 items-center text-sm text-ink-muted">{s.firstLevel}</span>
      </div>
    {/if}
  </div>
</div>
