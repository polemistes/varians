<script setup lang="ts">
import { Head, Link, useForm } from '@inertiajs/vue3';
import { store } from '@/actions/App/Http/Controllers/Auth/RegisterController';
import AppHeader from '@/components/AppHeader.vue';
import { login } from '@/routes';

const form = useForm({
    name: '',
    email: '',
    password: '',
    password_confirmation: '',
});

function submit() {
    form.post(store.url(), {
        onError: () => form.reset('password', 'password_confirmation'),
    });
}
</script>

<template>
    <Head title="Register" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-2xl">
            <AppHeader />

            <h1 class="mt-2 mb-1 font-serif text-2xl font-medium">Register</h1>
            <p class="mb-6 text-sm text-stone-500 dark:text-stone-400">
                New accounts start as a guest &mdash; you can read everything
                published here right away; an administrator can promote you to
                editor when you're ready to contribute.
            </p>

            <form class="flex flex-col gap-4" @submit.prevent="submit">
                <label class="flex flex-col gap-1 text-sm">
                    Name
                    <input
                        v-model="form.name"
                        type="text"
                        autofocus
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

                <label class="flex flex-col gap-1 text-sm">
                    Password
                    <input
                        v-model="form.password"
                        type="password"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                    <span class="text-xs text-stone-500 dark:text-stone-400">
                        At least 15 characters. Four or five unrelated words
                        make a password that is both easy to remember and hard
                        to guess &mdash; <em>rowan thimble gravel dusk</em>. No
                        capitals, digits or symbols are required.
                    </span>
                    <span
                        v-if="form.errors.password"
                        class="text-xs text-red-600 dark:text-red-400"
                        >{{ form.errors.password }}</span
                    >
                </label>

                <label class="flex flex-col gap-1 text-sm">
                    Confirm password
                    <input
                        v-model="form.password_confirmation"
                        type="password"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                </label>

                <div class="flex items-center gap-4">
                    <button
                        type="submit"
                        class="self-start rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                        :disabled="form.processing"
                    >
                        {{ form.processing ? 'Creating…' : 'Register' }}
                    </button>
                    <Link
                        :href="login.url()"
                        class="text-sm text-stone-500 hover:underline dark:text-stone-400"
                    >
                        Already have an account? Log in
                    </Link>
                </div>
            </form>
        </div>
    </div>
</template>
