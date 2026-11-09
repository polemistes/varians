<script lang="ts">
  import { enhance } from '$app/forms';
  import { Badge, Button, LocalDate, Select } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import { ROLES, type Role } from '$lib/types';

  export interface UserRow {
    id: string;
    name: string;
    email: string;
    role: Role;
    createdAt: string;
  }

  interface Props {
    users: UserRow[];
    currentUserId: string;
  }

  let { users, currentUserId }: Props = $props();

  const roleOptions = ROLES.map((role) => ({ value: role, label: s.admin.roles[role] ?? role }));
  let pending = $state<string | null>(null);
</script>

<div class="overflow-x-auto rounded-md border border-line bg-surface">
  <table class="w-full font-sans text-sm">
    <thead>
      <tr class="border-b border-line text-left text-xs text-ink-muted">
        <th scope="col" class="px-4 py-2.5 font-medium">{s.admin.user}</th>
        <th scope="col" class="px-4 py-2.5 font-medium">{s.admin.email}</th>
        <th scope="col" class="px-4 py-2.5 font-medium">{s.admin.joined}</th>
        <th scope="col" class="px-4 py-2.5 font-medium">{s.admin.role}</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-line">
      {#each users as user (user.id)}
        <tr>
          <td class="px-4 py-2.5 text-ink">
            {user.name}
            {#if user.id === currentUserId}<Badge class="ml-1.5">{s.admin.you}</Badge>{/if}
          </td>
          <td class="px-4 py-2.5 text-ink-soft">{user.email}</td>
          <td class="px-4 py-2.5 text-ink-soft"><LocalDate date={user.createdAt} /></td>
          <td class="px-4 py-2">
            <form
              method="post"
              action="?/role"
              class="flex items-center gap-2"
              use:enhance={() => {
                pending = user.id;
                return async ({ update }) => {
                  pending = null;
                  await update();
                };
              }}
            >
              <input type="hidden" name="userId" value={user.id} />
              <label class="sr-only" for="role-{user.id}">{s.admin.role}</label>
              <Select id="role-{user.id}" name="role" options={roleOptions} value={user.role} class="w-44" />
              <Button type="submit" variant="secondary" size="sm" loading={pending === user.id}>{s.admin.change}</Button>
            </form>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
