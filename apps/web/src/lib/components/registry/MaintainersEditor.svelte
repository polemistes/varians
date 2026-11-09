<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import UserMinus from '@lucide/svelte/icons/user-minus';
  import { Badge, Button, Field, IconButton, Input, toasts } from '$lib/components/ui';
  import type { Maintainer } from '$lib/registry/types';
  import { registry } from '$lib/strings/registry';

  interface Props {
    maintainers: Maintainer[];
    /** Adding and removing others: the creator's and administrators'. */
    canManage?: boolean;
    /** Whoever looks may always step down. */
    selfId?: string | null;
  }

  let { maintainers, canManage = true, selfId = null }: Props = $props();

  const s = registry.maintainers;
  let adding = $state(false);
  let removing = $state<string | null>(null);
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

  const remove: SubmitFunction = ({ formData }) => {
    removing = String(formData.get('userId'));
    return async ({ result, update }) => {
      removing = null;
      if (result.type === 'success') {
        toasts.success(s.removed(String(result.data?.name ?? '')));
        await update();
      } else if (result.type === 'failure') {
        toasts.error(String(result.data?.error ?? registry.common.forbidden));
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
          <form method="post" action="?/removeMaintainer" use:enhance={remove}>
            <input type="hidden" name="userId" value={maintainer.id} />
            <IconButton
              type="submit"
              label={s.remove(maintainer.name)}
              disabled={removing === maintainer.id}
            >
              <UserMinus aria-hidden="true" />
            </IconButton>
          </form>
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
