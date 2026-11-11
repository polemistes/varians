<script lang="ts">
  /**
   * The gear: how the reader likes to read. Text size, whether the
   * interpretative variants and the minor ones are marked and listed, the margin
   * labels, the dotted underline. The page keeps the choices per browser.
   */
  import Settings2 from '@lucide/svelte/icons/settings-2';
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
    onchange: (settings: ReaderSettings) => void;
  }

  let { settings, onchange }: Props = $props();

  function set<K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) {
    onchange({ ...settings, [key]: value });
  }

  const segment =
    'flex-1 cursor-pointer rounded px-2 py-1 text-center text-xs text-ink-soft transition-colors hover:text-ink has-[:checked]:bg-surface has-[:checked]:text-ink has-[:checked]:shadow-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent';
  const group = 'flex gap-0.5 rounded-md border border-line bg-sunken p-0.5';
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
      <legend class="mb-1.5 text-xs font-medium text-ink-soft">{r.settings.interpretative}</legend>
      <div class={group}>
        <label class={segment}>
          <input
            class="sr-only"
            type="radio"
            name="reader-interpretative"
            checked={settings.showInterpretative}
            onchange={() => set('showInterpretative', true)}
          />
          {r.settings.interpretativeShown}
        </label>
        <label class={segment}>
          <input
            class="sr-only"
            type="radio"
            name="reader-interpretative"
            checked={!settings.showInterpretative}
            onchange={() => set('showInterpretative', false)}
          />
          {r.settings.interpretativeHidden}
        </label>
      </div>
      <p class="text-xs text-ink-muted">{r.settings.interpretativeHint}</p>
    </fieldset>

    <fieldset class="flex flex-col gap-1.5">
      <legend class="mb-1.5 text-xs font-medium text-ink-soft">{r.settings.minor}</legend>
      <div class={group}>
        <label class={segment}>
          <input
            class="sr-only"
            type="radio"
            name="reader-minor"
            checked={settings.showMinor}
            onchange={() => set('showMinor', true)}
          />
          {r.settings.minorShown}
        </label>
        <label class={segment}>
          <input
            class="sr-only"
            type="radio"
            name="reader-minor"
            checked={!settings.showMinor}
            onchange={() => set('showMinor', false)}
          />
          {r.settings.minorHidden}
        </label>
      </div>
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
