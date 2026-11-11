<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import UserMinus from '@lucide/svelte/icons/user-minus';
  import {
    Badge,
    Button,
    ConfirmDialog,
    Field,
    IconButton,
    Input,
    toasts,
  } from '$lib/components/ui';
  import type { Maintainer } from '$lib/registry/types';
  import { recordActions as ra } from '$lib/strings/record-actions';
  import { registry } from '$lib/strings/registry';

  interface Props {
    maintainers: Maintainer[];
    /** Adding and removing others: the creator's and administrators'. */
    canManage?: boolean;
    /** Whoever looks may always step down. */
    selfId?: string | null;
    /** What the entry is, for the window that asks before one is removed. */
    entry?: 'work' | 'witness';
  }

  let { maintainers, canManage = true, selfId = null, entry = 'work' }: Props = $props();

  const s = registry.maintainers;
  let adding = $state(false);
  let asking = $state<Maintainer | null>(null);
  let askOpen = $state(false);
  let error = $state<string | null>(null);

  const add: SubmitFunction = () => {
    adding = true;
    return async ({ result, update }) => {
      adding = false;
      if (result.type === 'success') {
        error = null;
        toasts.success(s.added(String(result.data?.name ?? '')));
        await update();
      } else if (result.type === 'failure') {
        const errors = result.data?.errors as Record<string, string[] | undefined> | undefined;
        error =
          errors?.email?.[0] ??
          (result.data?.error as string | undefined) ??
          registry.common.invalidForm;
      } else {
        await update();
      }
    };
  };
</script>

<div class="flex flex-col gap-6">
  <ul class="divide-y divide-line rounded-md border border-line bg-surface font-sans">
    {#each maintainers as maintainer (maintainer.id)}
      <li class="flex items-center justify-between gap-4 px-4 py-2.5">
        <div class="min-w-0">
          <p class="truncate text-sm text-ink">
            {maintainer.name}
            {#if maintainer.isCreator}<Badge class="ml-1.5">{s.creator}</Badge>{/if}
          </p>
          <p class="truncate text-xs text-ink-soft">{maintainer.email}</p>
        </div>
        {#if !maintainer.isCreator && (canManage || maintainer.id === selfId)}
          <IconButton
            label={ra.maintainer.remove(maintainer.name)}
            onclick={() => {
              asking = maintainer;
              askOpen = true;
            }}
          >
            <UserMinus aria-hidden="true" />
          </IconButton>
        {/if}
      </li>
    {/each}
  </ul>

  {#if canManage}
    <form
      method="post"
      action="?/addMaintainer"
      class="flex flex-col gap-3"
      novalidate
      use:enhance={add}
    >
      <Field label={s.email} {error}>
        {#snippet children(control)}
          <Input {...control} type="email" name="email" autocomplete="off" required />
        {/snippet}
      </Field>
      <div>
        <Button type="submit" variant="secondary" loading={adding}>{s.add}</Button>
      </div>
    </form>
  {/if}
</div>

<ConfirmDialog
  bind:open={askOpen}
  title={ra.maintainer.removeTitle}
  description={asking?.id === selfId
    ? ra.maintainer.removeSelfBody(entry)
    : ra.maintainer.removeBody(asking?.name ?? '', entry)}
  confirmLabel={ra.maintainer.removeVerb}
  action="?/removeMaintainer"
  fields={{ userId: asking?.id ?? '' }}
  done={s.removed(asking?.name ?? '')}
/>
