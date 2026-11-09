<script lang="ts">
  import UsersTable from '$lib/components/admin/UsersTable.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { EmptyState, Input, Notice, toasts } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  // Depends on the action result only, so that the reload of the list after
  // a change does not toast a second time.
  $effect(() => {
    if (!form) return;
    if (!form.ok) toasts.error(form.error);
    else if (form.action === 'role') toasts.success(s.admin.roleChanged(form.name, s.admin.roles[form.role] ?? form.role));
    else if (form.action === 'reset' && !form.link) toasts.success(s.admin.resetLinkSent(form.name));
  });

  const madeLink = $derived(form?.ok && form.action === 'reset' && form.link ? { name: form.name, link: form.link } : null);
</script>

<PageFrame title={s.admin.usersTitle} lead={s.admin.usersLead}>
  {#if madeLink}
    <Notice class="mb-6">
      <p>{s.admin.resetLinkMade(madeLink.name)}</p>
      <label class="sr-only" for="reset-link">{s.admin.makeResetLink}</label>
      <Input id="reset-link" class="mt-2 font-mono text-xs" readonly value={madeLink.link} onfocus={(event) => (event.currentTarget as HTMLInputElement).select()} />
    </Notice>
  {/if}
  {#if data.users.length === 0}
    <EmptyState description={s.admin.noUsers} />
  {:else if data.user}
    <UsersTable users={data.users} currentUserId={data.user.id} mail={data.mail} />
  {/if}
</PageFrame>
