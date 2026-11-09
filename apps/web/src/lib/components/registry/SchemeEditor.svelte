<script lang="ts">
  import { untrack } from 'svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import { SCHEME_PRESETS, type Level } from '@varians/core';
  import { Button, Field, Notice, Select } from '$lib/components/ui';
  import { CUSTOM_SCHEME } from '$lib/registry/constants';
  import {
    emptyLevel,
    exampleLabel,
    keyFromLabel,
    schemeProblems,
    schemeSentence,
  } from '$lib/registry/scheme';
  import { registry } from '$lib/strings/registry';
  import LevelRow from './LevelRow.svelte';

  interface Props {
    /**
     * create: a preset or custom levels, sent as `scheme` and `levels`.
     * edit: the levels of a work's scheme, sent as `levels`.
     */
    mode?: 'create' | 'edit';
    /** The preset chosen at first, or 'custom' (create only). */
    choice?: string;
    /** The levels at first: the work's (edit) or what was sent (create, custom). */
    levels?: Level[];
    /** Keys and types fixed, no levels added or removed: the work has segments. */
    locked?: boolean;
    /** The server's verdict on what was sent. */
    error?: string | string[] | null;
  }

  let {
    mode = 'create',
    choice: initialChoice,
    levels: initialLevels,
    locked = false,
    error,
  }: Props = $props();

  const s = registry.scheme;
  const presetOptions = [
    ...SCHEME_PRESETS.map((p) => ({ value: p.name, label: p.name })),
    { value: CUSTOM_SCHEME, label: s.custom },
  ];

  const copy = (levels: Level[]) => levels.map((l) => ({ ...l }));
  const presetLevels = (name: string) =>
    SCHEME_PRESETS.find((p) => p.name === name)?.scheme.levels ?? [];

  // The initial values only; the editor owns them from here on.
  let choice = $state(untrack(() => initialChoice ?? SCHEME_PRESETS[0]!.name));
  let levels = $state<Level[]>(
    untrack(() =>
      initialLevels?.length
        ? copy(initialLevels)
        : copy(presetLevels(initialChoice ?? SCHEME_PRESETS[0]!.name)),
    ),
  );
  /** Whether custom levels have been edited; until then they follow the last preset. */
  let touched = $state(untrack(() => mode === 'edit' || initialChoice === CUSTOM_SCHEME));

  const custom = $derived(mode === 'edit' || choice === CUSTOM_SCHEME);
  const effective = $derived(custom ? levels : presetLevels(choice));
  const problems = $derived(custom ? schemeProblems(levels) : []);
  const sentence = $derived(
    effective.length && problems.length === 0 ? schemeSentence({ levels: effective }) : '',
  );
  const serialized = $derived(
    JSON.stringify(levels.map((l, i) => ({ ...l, separator: i === 0 ? '' : l.separator }))),
  );

  function choose(value: string) {
    if (value === CUSTOM_SCHEME && !touched) levels = copy(presetLevels(choice));
    choice = value;
  }

  function change(index: number, patch: Partial<Level>) {
    touched = true;
    const level = levels[index]!;
    const next = { ...level, ...patch };
    // A key that followed the label keeps following it.
    if (
      patch.label !== undefined &&
      !locked &&
      (level.key === '' || level.key === keyFromLabel(level.label))
    ) {
      next.key = keyFromLabel(patch.label);
    }
    levels[index] = next;
  }

  function move(index: number, by: -1 | 1) {
    const target = index + by;
    if (target < 0 || target >= levels.length) return;
    touched = true;
    const next = [...levels];
    [next[index], next[target]] = [next[target]!, next[index]!];
    levels = next;
  }

  function remove(index: number) {
    if (levels.length === 1) return;
    touched = true;
    levels = levels.filter((_, i) => i !== index);
  }

  function add() {
    touched = true;
    levels = [...levels, emptyLevel(levels.length)];
  }
</script>

<div class="flex flex-col gap-4">
  {#if mode === 'create'}
    <Field
      label={registry.work.scheme}
      error={error && !custom ? error : undefined}
      required
    >
      {#snippet children(control)}
        <Select
          {...control}
          name="scheme"
          value={choice}
          options={presetOptions}
          onchange={(e) => choose(e.currentTarget.value)}
        />
      {/snippet}
    </Field>
  {/if}

  {#if sentence}
    <p class="font-sans text-sm text-ink-soft" aria-live="polite">
      {custom ? s.exampleOf(exampleLabel({ levels: effective })) : sentence}
    </p>
  {/if}

  {#if custom}
    <input type="hidden" name="levels" value={serialized} />
    {#if locked}
      <Notice kind="info">{registry.work.schemeLocked}</Notice>
    {:else}
      <p class="font-sans text-xs text-ink-soft">{s.editorHint}</p>
    {/if}
    <div class="flex flex-col gap-3">
      {#each levels as level, index (index)}
        <LevelRow
          {level}
          {index}
          count={levels.length}
          {locked}
          onchange={(patch) => change(index, patch)}
          onmove={(by) => move(index, by)}
          onremove={() => remove(index)}
        />
      {/each}
    </div>
    {#if !locked}
      <div>
        <Button size="sm" variant="secondary" onclick={add}>
          <Plus class="size-4" aria-hidden="true" />
          {s.addLevel}
        </Button>
      </div>
    {/if}
    {#if problems.length || (error && custom)}
      <Notice kind={problems.length ? 'warning' : 'error'} title={s.problems}>
        <ul class="list-disc pl-4">
          {#each problems.length ? problems : Array.isArray(error) ? error : [error] as problem, i (i)}
            <li>{problem}</li>
          {/each}
        </ul>
      </Notice>
    {/if}
  {/if}
</div>
