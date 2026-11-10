<script lang="ts">
  /**
   * The gear: how the reader likes to read. Text size, whether the print
   * apparatus shows on screen and where (with its form), where interpretative
   * variants show, the margin labels, the dotted underline. The page keeps the choices per browser.
   */
  import Settings2 from '@lucide/svelte/icons/settings-2';
  import type { ApparatusConventions } from '@varians/core';
  import { Checkbox, Popover } from '$lib/components/ui';
  import {
    DEFAULT_SETTINGS,
    TEXT_SIZES,
    isDefault,
    type ReaderSettings,
  } from '$lib/reader/settings';
  import { reader as r } from '$lib/strings/reader';

  interface Props {
    settings: ReaderSettings;
    /** What the edition sets, shown as the default of each choice. */
    edition: ApparatusConventions;
    onchange: (settings: ReaderSettings) => void;
  }

  let { settings, edition, onchange }: Props = $props();

  const form = $derived(settings.form ?? edition.form);
  const interpretative = $derived(settings.interpretative ?? edition.interpretative);

  function set<K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) {
    onchange({ ...settings, [key]: value });
  }

  const segment =
    'flex-1 cursor-pointer rounded px-2 py-1 text-center text-xs text-ink-soft transition-colors hover:text-ink has-[:checked]:bg-surface has-[:checked]:text-ink has-[:checked]:shadow-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent';
  const group = 'flex gap-0.5 rounded-md border border-line bg-sunken p-0.5';
  const option =
    'cursor-pointer rounded px-2.5 py-1.5 text-xs text-ink-soft transition-colors hover:text-ink has-[:checked]:bg-surface has-[:checked]:text-ink has-[:checked]:shadow-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent';
  const placements = [
    { value: 'none', label: r.settings.apparatusNone },
    { value: 'foot', label: r.settings.apparatusFoot },
    { value: 'side', label: r.settings.apparatusSide },
  ] as const;
  const interpretativePlacements = (['apparatus', 'separate', 'none'] as const).map((value) => ({
    value,
    label: r.settings.interpretativeOptions[value],
  }));
</script>

<Popover
  label={r.toolbar.settings}
  triggerVariant="ghost"
  triggerSize="sm"
  triggerClass="w-8 px-0"
  align="end"
  class="w-80"
>
  {#snippet trigger()}
    <Settings2 class="size-4 text-ink-soft" aria-hidden="true" />
  {/snippet}
  <div class="flex flex-col gap-4">
    <h2 class="text-sm font-medium text-ink">{r.settings.title}</h2>

    <fieldset class="flex flex-col gap-1.5">
      <legend class="mb-1.5 text-xs font-medium text-ink-soft">{r.settings.textSize}</legend>
      <div class={group}>
        {#each TEXT_SIZES as size (size)}
          <label class={segment}>
            <input
              class="sr-only"
              type="radio"
              name="reader-size"
              value={size}
              checked={settings.size === size}
              onchange={() => set('size', size)}
            />
            <span class={size === 'small' ? 'text-[0.7rem]' : size === 'large' ? 'text-sm' : ''}
              >{r.settings.sizes[size]}</span
            >
          </label>
        {/each}
      </div>
    </fieldset>

    <fieldset class="flex flex-col gap-1.5">
      <legend class="mb-1.5 text-xs font-medium text-ink-soft">{r.settings.apparatus}</legend>
      <div class="flex flex-col gap-0.5 rounded-md border border-line bg-sunken p-0.5">
        {#each placements as placement (placement.value)}
          <label class={option}>
            <input
              class="sr-only"
              type="radio"
              name="reader-apparatus"
              value={placement.value}
              checked={settings.apparatus === placement.value}
              onchange={() => set('apparatus', placement.value)}
            />
            {placement.label}
          </label>
        {/each}
      </div>
      {#if settings.apparatus === 'none'}
        <p class="text-xs text-ink-muted">{r.settings.apparatusNoneHint}</p>
      {:else}
        {#if settings.apparatus === 'side'}<p class="text-xs text-ink-muted">
            {r.settings.apparatusSideHint}
          </p>{/if}
        <p class="mt-1.5 text-xs text-ink-soft" id="reader-form-label">{r.settings.form}</p>
        <div class={group} role="radiogroup" aria-labelledby="reader-form-label">
          <label class={segment}>
            <input
              class="sr-only"
              type="radio"
              name="reader-form"
              checked={form === 'positive'}
              onchange={() => set('form', edition.form === 'positive' ? null : 'positive')}
            />
            {r.settings.positive}
          </label>
          <label class={segment}>
            <input
              class="sr-only"
              type="radio"
              name="reader-form"
              checked={form === 'negative'}
              onchange={() => set('form', edition.form === 'negative' ? null : 'negative')}
            />
            {r.settings.negative}
          </label>
        </div>
        <p class="text-xs text-ink-muted">{r.settings.editionForm(edition.form)}</p>
      {/if}
    </fieldset>

    <fieldset class="flex flex-col gap-1.5">
      <legend class="mb-1.5 text-xs font-medium text-ink-soft">{r.settings.interpretative}</legend>
      <div class="flex flex-col gap-0.5 rounded-md border border-line bg-sunken p-0.5">
        {#each interpretativePlacements as placement (placement.value)}
          <label class={option}>
            <input
              class="sr-only"
              type="radio"
              name="reader-interpretative"
              value={placement.value}
              checked={interpretative === placement.value}
              onchange={() =>
                set(
                  'interpretative',
                  edition.interpretative === placement.value ? null : placement.value,
                )}
            />
            {placement.label}
          </label>
        {/each}
      </div>
      <p class="text-xs text-ink-muted">
        {r.settings.interpretativeHint}
        {r.settings.editionInterpretative(edition.interpretative)}
      </p>
    </fieldset>

    <fieldset class="flex flex-col gap-1.5">
      <legend class="mb-1.5 text-xs font-medium text-ink-soft">{r.settings.labels}</legend>
      <div class={group}>
        <label class={segment}>
          <input
            class="sr-only"
            type="radio"
            name="reader-labels"
            checked={settings.labels === 'edition'}
            onchange={() => set('labels', 'edition')}
          />
          {r.settings.labelsEdition}
        </label>
        <label class={segment}>
          <input
            class="sr-only"
            type="radio"
            name="reader-labels"
            checked={settings.labels === 'every'}
            onchange={() => set('labels', 'every')}
          />
          {r.settings.labelsEvery}
        </label>
      </div>
    </fieldset>

    <Checkbox
      checked={settings.underline}
      onchange={(event) => set('underline', (event.currentTarget as HTMLInputElement).checked)}
    >
      {r.settings.underline}
    </Checkbox>

    <div class="flex justify-end border-t border-line pt-3">
      <button
        type="button"
        class="rounded px-2 py-1 text-xs text-ink-soft hover:bg-sunken hover:text-ink disabled:opacity-50"
        disabled={isDefault(settings)}
        onclick={() => onchange({ ...DEFAULT_SETTINGS })}
      >
        {r.settings.reset}
      </button>
    </div>
  </div>
</Popover>
