<script lang="ts">
  import NameForm from '$lib/components/account/NameForm.svelte';
  import OrcidForm from '$lib/components/account/OrcidForm.svelte';
  import PasswordForm from '$lib/components/account/PasswordForm.svelte';
  import PreferencesForm from '$lib/components/account/PreferencesForm.svelte';
  import SettingsSection from '$lib/components/account/SettingsSection.svelte';
  import { enhance } from '$app/forms';
  import { PageFrame } from '$lib/components/shell';
  import { Button, ConfirmDialog, LocalDate, Notice } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import { recordActions as ra } from '$lib/strings/record-actions';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  let revoking = $state<{ id: string; name: string } | null>(null);
  let revokeOpen = $state(false);
</script>

<PageFrame title={s.account.title} width="reading">
  {#if data.user}
    {#if data.offers.incoming.length || data.offers.outgoing.length}
      <SettingsSection title={s.account.offersSection} hint={s.account.offersHint}>
        <ul class="flex flex-col gap-3 font-sans text-sm">
          {#each data.offers.incoming as offer (offer.id)}
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span class="text-ink"
                >{#if offer.href}<a class="font-serif hover:underline" href={offer.href}
                    >{offer.title}</a
                  >{:else}<span class="font-serif">{offer.title}</span>{/if}
                {s.account.offerFrom(offer.fromName)}</span
              >
              <span class="text-xs text-ink-muted"><LocalDate date={offer.createdAt} /></span>
              <form method="POST" action="?/offer" use:enhance class="ml-auto flex gap-2">
                <input type="hidden" name="offerId" value={offer.id} />
                <Button size="sm" variant="primary" type="submit" name="answer" value="accept"
                  >{s.account.accept}</Button
                >
                <Button size="sm" variant="ghost" type="submit" name="answer" value="decline"
                  >{s.account.decline}</Button
                >
              </form>
            </li>
          {/each}
          {#each data.offers.outgoing as offer (offer.id)}
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span class="text-ink-soft"
                >{#if offer.href && offer.kind === 'edition'}<a
                    class="font-serif text-ink hover:underline"
                    href={offer.href}>{offer.title}</a
                  >{:else}<span class="font-serif text-ink">{offer.title}</span>{/if}
                {s.account.offeredTo(offer.toName)}</span
              >
              <form method="POST" action="?/offer" use:enhance class="ml-auto">
                <input type="hidden" name="offerId" value={offer.id} />
                <Button size="sm" variant="ghost" type="submit" name="answer" value="withdraw"
                  >{s.account.withdraw}</Button
                >
              </form>
            </li>
          {/each}
        </ul>
      </SettingsSection>
    {/if}
    <SettingsSection title={s.account.nameSection} hint={s.account.nameHint}>
      <NameForm name={data.user.name} result={form} />
    </SettingsSection>
    <SettingsSection title={s.account.orcidSection} hint={s.account.orcidHint}>
      <OrcidForm orcid={data.orcid} result={form} />
    </SettingsSection>
    <SettingsSection title={s.account.tokensSection} hint={s.account.tokensHint}>
      {#if form?.form === 'token' && form.token}
        <Notice class="mb-3"
          ><p>{s.account.tokenMade}</p>
          <code class="mt-1 block break-all font-mono text-xs select-all">{form.token}</code
          ></Notice
        >
      {/if}
      {#if data.tokens.length}
        <ul class="mb-4 flex flex-col gap-2 font-sans text-sm">
          {#each data.tokens as token (token.id)}
            <li class="flex flex-wrap items-center gap-x-3">
              <span class="text-ink">{token.name}</span>
              <span class="text-xs text-ink-muted"
                ><LocalDate date={token.createdAt} />, {#if token.lastUsedAt}{s.account.lastUsed}
                  <LocalDate date={token.lastUsedAt} />{:else}{s.account.neverUsed}{/if}</span
              >
              <Button
                size="sm"
                variant="ghost"
                class="ml-auto"
                aria-label={ra.token.revokeOf(token.name)}
                onclick={() => {
                  revoking = { id: token.id, name: token.name };
                  revokeOpen = true;
                }}>{ra.token.revoke}</Button
              >
            </li>
          {/each}
        </ul>
      {/if}
      <form method="POST" action="?/token" use:enhance class="flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1 font-sans text-sm"
          ><span>{s.account.tokenName}</span><input
            name="name"
            maxlength="100"
            class="rounded border border-line px-2 py-1"
          /></label
        >
        <Button type="submit" variant="secondary">{s.account.makeToken}</Button>
      </form>
    </SettingsSection>
    <SettingsSection title={s.account.passwordSection}>
      <PasswordForm result={form} />
    </SettingsSection>
    <SettingsSection title={s.account.appearanceSection}>
      <PreferencesForm preferences={data.user.preferences} result={form} />
    </SettingsSection>
  {/if}
</PageFrame>

<ConfirmDialog
  bind:open={revokeOpen}
  title={ra.token.revokeTitle}
  description={ra.token.revokeBody(revoking?.name ?? '')}
  confirmLabel={ra.token.revokeVerb}
  action="?/revoke"
  fields={{ id: revoking?.id ?? '' }}
  done={s.account.tokenRevoked}
/>
