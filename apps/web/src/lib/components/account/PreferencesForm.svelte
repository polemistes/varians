<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button, toasts } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import type { Font, Preferences, Theme } from '$lib/types';
  import type { AccountActionResult } from './types';

  interface Props {
    preferences: Preferences;
    result: AccountActionResult | null | undefined;
  }

  let { preferences, result }: Props = $props();
  let submitting = $state(false);

  const mine = $derived(result?.form === 'preferences' ? result : undefined);

  $effect(() => {
    if (mine?.ok) toasts.success(s.account.saved);
  });

  const fonts: Array<{ value: Font; label: string; family: string }> = [
    { value: 'eb-garamond', label: s.account.fontGaramond, family: "'EB Garamond', serif" },
    { value: 'cardo', label: s.account.fontCardo, family: "'Cardo', serif" },
  ];
  const themes: Array<{ value: Theme; label: string }> = [
    { value: 'system', label: s.account.themeSystem },
    { value: 'light', label: s.account.themeLight },
    { value: 'dark', label: s.account.themeDark },
  ];

  const option =
    'flex cursor-pointer items-center gap-3 rounded-md border border-line px-3 py-2.5 font-sans text-sm text-ink transition-colors hover:bg-sunken has-[:checked]:border-accent has-[:checked]:bg-accent-soft/60';
</script>

<form
  method="post"
  action="?/preferences"
  class="flex flex-col gap-6"
  use:enhance={() => {
    submitting = true;
    return async ({ update }) => {
      submitting = false;
      await update({ reset: false });
    };
  }}
>
  <fieldset class="flex flex-col gap-2">
    <legend class="mb-2 font-sans text-sm font-medium text-ink">{s.account.font}</legend>
    {#each fonts as font (font.value)}
      <label class={option}>
        <input type="radio" name="font" value={font.value} checked={preferences.font === font.value} />
        <span class="w-28 shrink-0">{font.label}</span>
        <span class="truncate text-lg text-ink-soft" style="font-family: {font.family}" lang="grc">{s.account.sample}</span>
      </label>
    {/each}
  </fieldset>

  <fieldset class="flex flex-col gap-2">
    <legend class="mb-2 font-sans text-sm font-medium text-ink">{s.account.theme}</legend>
    {#each themes as theme (theme.value)}
      <label class={option}>
        <input type="radio" name="theme" value={theme.value} checked={preferences.theme === theme.value} />
        <span>{theme.label}</span>
      </label>
    {/each}
  </fieldset>

  <div>
    <Button type="submit" variant="primary" loading={submitting}>{s.account.save}</Button>
  </div>
</form>
