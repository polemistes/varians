<script lang="ts">
  import UsersTable from '$lib/components/admin/UsersTable.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { EmptyState, toasts } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  // Depends on the action result only, so that the reload of the list after
  // a change does not toast a second time.
  $effect(() => {
    if (!form) return;
    if (form.ok) toasts.success(s.admin.roleChanged(form.name, s.admin.roles[form.role] ?? form.role));
    else toasts.error(form.error);
  });
</script>

<PageFrame title={s.admin.usersTitle} lead={s.admin.usersLead}>
  {#if data.users.length === 0}
    <EmptyState description={s.admin.noUsers} />
  {:else if data.user}
    <UsersTable users={data.users} currentUserId={data.user.id} />
  {/if}
</PageFrame>
