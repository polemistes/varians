<script setup lang="ts">
import { Head, useForm, usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import { update } from '@/actions/App/Http/Controllers/ProfileController';
import AppHeader from '@/components/AppHeader.vue';
import type { Auth } from '@/types/auth';

const page = usePage<{ auth: Auth }>();
const user = computed(() => page.props.auth.user);

const form = useForm({
    name: user.value?.name ?? '',
    email: user.value?.email ?? '',
    password: '',
    password_confirmation: '',
});

function submit() {
    form.patch(update.url(), {
        preserveScroll: true,
        onSuccess: () => form.reset('password', 'password_confirmation'),
    });
}
</script>

<template>
    <Head title="Profile" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-2xl">
            <AppHeader />

            <h1 class="mt-2 mb-1 font-serif text-2xl font-medium">Profile</h1>
            <p
                v-if="user"
                class="mb-6 text-sm text-stone-500 dark:text-stone-400"
            >
                Role: {{ user.role }}
            </p>

            <form class="flex flex-col gap-4" @submit.prevent="submit">
                <label class="flex flex-col gap-1 text-sm">
                    Name
                    <input
                        v-model="form.name"
                        type="text"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                    <span
                        v-if="form.errors.name"
                        class="text-xs text-red-600 dark:text-red-400"
                        >{{ form.errors.name }}</span
                    >
                </label>

                <label class="flex flex-col gap-1 text-sm">
                    Email
                    <input
                        v-model="form.email"
                        type="email"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                    <span
                        v-if="form.errors.email"
                        class="text-xs text-red-600 dark:text-red-400"
                        >{{ form.errors.email }}</span
                    >
                </label>

                <fieldset
                    class="rounded-lg border border-stone-200 p-3 dark:border-stone-800"
                >
                    <legend class="px-1 text-sm font-medium">
                        Change password
                    </legend>
                    <p class="mb-3 text-xs text-stone-500 dark:text-stone-400">
                        Leave blank to keep your current password. A new one
                        needs at least 15 characters; four or five unrelated
                        words are easier to remember and harder to guess than
                        anything shorter with symbols in it.
                    </p>
                    <div class="flex flex-col gap-3">
                        <label class="flex flex-col gap-1 text-sm">
                            New password
                            <input
                                v-model="form.password"
                                type="password"
                                class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                            />
                            <span
                                v-if="form.errors.password"
                                class="text-xs text-red-600 dark:text-red-400"
                                >{{ form.errors.password }}</span
                            >
                        </label>
                        <label class="flex flex-col gap-1 text-sm">
                            Confirm new password
                            <input
                                v-model="form.password_confirmation"
                                type="password"
                                class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                            />
                        </label>
                    </div>
                </fieldset>

                <button
                    type="submit"
                    class="self-start rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                    :disabled="form.processing"
                >
                    {{ form.processing ? 'Saving…' : 'Save changes' }}
                </button>
                <span
                    v-if="form.recentlySuccessful"
                    class="text-xs text-stone-500 dark:text-stone-400"
                >
                    Saved.
                </span>
            </form>
        </div>
    </div>
</template>
