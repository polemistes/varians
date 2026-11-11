<script lang="ts">
  /**
   * Owner and Collaborators, on Edition Settings, for those who may grant:
   * the collaborators, invited by email and removed after the window asks,
   * and the offer of the ownership to another account. Each acts at once,
   * not through the page's Save: these are records of their own.
   */
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { Section } from '$lib/components/registry';
  import { Button, ConfirmDialog, Field, Input, toasts } from '$lib/components/ui';
  import { recordActions } from '$lib/strings/record-actions';

  interface Props {
    owner: string;
    collaborators: { userId: string; name: string; email: string }[];
    /** An open offer of the ownership, to whom. */
    offer: { toName: string } | null;
  }

  let { owner, collaborators, offer }: Props = $props();

  const t = recordActions.edition.people;
  let inviting = $state(false);
  let inviteError = $state<string | null>(null);
  let offering = $state(false);
  let offerError = $state<string | null>(null);
  let removing = $state<{ userId: string; name: string } | null>(null);
  let removeOpen = $state(false);

  /** A form of this section: a refusal under its field, else a message and the page loaded again. */
  function submitted(
    busy: (value: boolean) => void,
    refuse: (message: string | null) => void,
  ): SubmitFunction {
    return () => {
      busy(true);
      return async ({ result, update }) => {
        busy(false);
        if (result.type === 'failure') {
          refuse(String(result.data?.error ?? recordActions.failed));
          return;
        }
        refuse(null);
        if (result.type === 'success' && result.data?.message)
          toasts.success(String(result.data.message));
        await update();
      };
    };
  }
</script>

<div class="mt-12">
  <Section title={t.title}>
    <div class="flex flex-col gap-8 font-sans text-sm">
      <div class="flex flex-col gap-1">
        <h3 class="font-medium text-ink">{t.owner}</h3>
        <p class="text-ink">{owner}</p>
        {#if offer}<p class="text-xs text-ink-soft">{t.openOffer(offer.toName)}</p>{/if}
      </div>

      <div class="flex flex-col gap-3">
        <div>
          <h3 class="font-medium text-ink">{t.collaborators}</h3>
          <p class="mt-1 text-xs text-ink-soft">{t.collaboratorsHint}</p>
        </div>
        {#if collaborators.length}
          <ul class="divide-y divide-line rounded-md border border-line bg-surface">
            {#each collaborators as person (person.userId)}
              <li class="flex items-center justify-between gap-4 px-4 py-2.5">
                <div class="min-w-0">
                  <p class="truncate text-ink">{person.name}</p>
                  <p class="truncate text-xs text-ink-soft">{person.email}</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={t.removeOf(person.name)}
                  onclick={() => {
                    removing = person;
                    removeOpen = true;
                  }}>{t.remove}</Button
                >
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-ink-muted">{t.nobody}</p>
        {/if}
        <form
          method="POST"
          action="?/addCollaborator"
          class="flex max-w-md flex-col gap-3"
          novalidate
          use:enhance={submitted(
            (v) => (inviting = v),
            (m) => (inviteError = m),
          )}
        >
          <Field label={t.invite} error={inviteError}>
            {#snippet children(control)}
              <Input {...control} name="email" type="email" autocomplete="off" required />
            {/snippet}
          </Field>
          <div>
            <Button type="submit" variant="secondary" loading={inviting}>{t.inviteAction}</Button>
          </div>
        </form>
      </div>

      {#if !offer}
        <form
          method="POST"
          action="?/offerOwnership"
          class="flex max-w-md flex-col gap-3"
          novalidate
          use:enhance={submitted(
            (v) => (offering = v),
            (m) => (offerError = m),
          )}
        >
          <Field label={t.offer} hint={t.offerHint} error={offerError}>
            {#snippet children(control)}
              <Input {...control} name="email" type="email" autocomplete="off" required />
            {/snippet}
          </Field>
          <div>
            <Button type="submit" variant="secondary" loading={offering}>{t.offerAction}</Button>
          </div>
        </form>
      {/if}
    </div>
  </Section>
</div>

<ConfirmDialog
  bind:open={removeOpen}
  title={t.removeTitle}
  description={t.removeBody(removing?.name ?? '')}
  confirmLabel={t.removeVerb}
  action="?/removeCollaborator"
  fields={{ userId: removing?.userId ?? '' }}
/>
