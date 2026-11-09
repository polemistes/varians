<script lang="ts">
  import NameForm from '$lib/components/account/NameForm.svelte';
  import PasswordForm from '$lib/components/account/PasswordForm.svelte';
  import PreferencesForm from '$lib/components/account/PreferencesForm.svelte';
  import SettingsSection from '$lib/components/account/SettingsSection.svelte';
  import { enhance } from '$app/forms';
  import { PageFrame } from '$lib/components/shell';
  import { Button, LocalDate } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<PageFrame title={s.account.title} width="reading">
  {#if data.user}
    {#if data.offers.incoming.length || data.offers.outgoing.length}
      <SettingsSection title={s.account.offersSection} hint={s.account.offersHint}>
        <ul class="flex flex-col gap-3 font-sans text-sm">
          {#each data.offers.incoming as offer (offer.id)}
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span class="text-ink"><a class="font-serif hover:underline" href={offer.href}>{offer.title}</a> {s.account.offerFrom(offer.fromName)}</span>
              <span class="text-xs text-ink-muted"><LocalDate date={offer.createdAt} /></span>
              <form method="POST" action="?/offer" use:enhance class="ml-auto flex gap-2">
                <input type="hidden" name="offerId" value={offer.id} />
                <Button size="sm" variant="primary" type="submit" name="answer" value="accept">{s.account.accept}</Button>
                <Button size="sm" variant="ghost" type="submit" name="answer" value="decline">{s.account.decline}</Button>
              </form>
            </li>
          {/each}
          {#each data.offers.outgoing as offer (offer.id)}
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span class="text-ink-soft"><span class="font-serif text-ink">{offer.title}</span> {s.account.offeredTo(offer.toName)}</span>
              <form method="POST" action="?/offer" use:enhance class="ml-auto">
                <input type="hidden" name="offerId" value={offer.id} />
                <Button size="sm" variant="ghost" type="submit" name="answer" value="withdraw">{s.account.withdraw}</Button>
              </form>
            </li>
          {/each}
        </ul>
      </SettingsSection>
    {/if}
    <SettingsSection title={s.account.nameSection} hint={s.account.nameHint}>
      <NameForm name={data.user.name} result={form} />
    </SettingsSection>
    <SettingsSection title={s.account.passwordSection}>
      <PasswordForm result={form} />
    </SettingsSection>
    <SettingsSection title={s.account.appearanceSection}>
      <PreferencesForm preferences={data.user.preferences} result={form} />
    </SettingsSection>
  {/if}
</PageFrame>
