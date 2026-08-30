<script setup lang="ts">
import { Head, Link, useForm } from '@inertiajs/vue3';
import { store } from '@/actions/App/Http/Controllers/Auth/LoginController';
import AppHeader from '@/components/AppHeader.vue';
import { register } from '@/routes';

const form = useForm({
    email: '',
    password: '',
    remember: false,
});

function submit() {
    form.post(store.url(), {
        onError: () => form.reset('password'),
    });
}
</script>

<template>
    <Head title="Log in" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-2xl">
            <AppHeader />

            <h1 class="mt-2 mb-6 font-serif text-2xl font-medium">Log in</h1>

            <form class="flex flex-col gap-4" @submit.prevent="submit">
                <label class="flex flex-col gap-1 text-sm">
                    Email
                    <input
                        v-model="form.email"
                        type="email"
                        autofocus
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
                    <span
                        v-if="form.errors.password"
                        class="text-xs text-red-600 dark:text-red-400"
                        >{{ form.errors.password }}</span
                    >
                </label>

                <label class="flex items-center gap-2 text-sm">
                    <input v-model="form.remember" type="checkbox" />
                    Remember me
                </label>

                <div class="flex items-center gap-4">
                    <button
                        type="submit"
                        class="self-start rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                        :disabled="form.processing"
                    >
                        {{ form.processing ? 'Logging in…' : 'Log in' }}
                    </button>
                    <Link
                        :href="register.url()"
                        class="text-sm text-stone-500 hover:underline dark:text-stone-400"
                    >
                        Need an account? Register
                    </Link>
                </div>
            </form>
        </div>
    </div>
</template>
