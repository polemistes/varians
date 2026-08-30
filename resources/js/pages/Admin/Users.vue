<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { updateRole } from '@/actions/App/Http/Controllers/Admin/UsersController';
import AppHeader from '@/components/AppHeader.vue';
import type { Role } from '@/types/auth';

type AdminUser = {
    id: number;
    name: string;
    email: string;
    role: Role;
    created_at: string;
};

const props = defineProps<{
    users: AdminUser[];
}>();

function changeRole(user: AdminUser, role: Role) {
    router.patch(updateRole.url(user.id), { role }, { preserveScroll: true });
}
</script>

<template>
    <Head title="Users" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-3xl">
            <AppHeader />

            <h1 class="mt-2 mb-6 font-serif text-2xl font-medium">Users</h1>

            <table class="w-full text-left text-sm">
                <thead>
                    <tr
                        class="border-b border-stone-200 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400"
                    >
                        <th class="pb-2 font-medium">Name</th>
                        <th class="pb-2 font-medium">Email</th>
                        <th class="pb-2 font-medium">Role</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="user in props.users"
                        :key="user.id"
                        class="border-b border-stone-100 dark:border-stone-900"
                    >
                        <td class="py-2">{{ user.name }}</td>
                        <td class="py-2 text-stone-500 dark:text-stone-400">
                            {{ user.email }}
                        </td>
                        <td class="py-2">
                            <select
                                :value="user.role"
                                class="rounded border border-stone-300 bg-transparent px-2 py-1 text-sm dark:border-stone-700"
                                @change="
                                    changeRole(
                                        user,
                                        ($event.target as HTMLSelectElement)
                                            .value as Role,
                                    )
                                "
                            >
                                <option value="guest">Guest</option>
                                <option value="editor">Editor</option>
                                <option value="administrator">
                                    Administrator
                                </option>
                            </select>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
