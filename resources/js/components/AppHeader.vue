<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import { store as storeLogout } from '@/actions/App/Http/Controllers/Auth/LogoutController';
import { home, login, register } from '@/routes';
import { index as adminUsers } from '@/routes/admin/users';
import { edit as editProfile } from '@/routes/profile';
import type { Auth } from '@/types/auth';

const page = usePage<{ auth: Auth }>();
const auth = computed(() => page.props.auth);
</script>

<template>
    <header
        class="mb-6 flex items-center justify-between text-sm text-stone-600 dark:text-stone-400"
    >
        <Link
            :href="home.url()"
            class="font-serif text-lg text-[#1b1b18] dark:text-[#EDEDEC]"
        >
            Varians
        </Link>

        <nav class="flex items-center gap-4">
            <template v-if="auth.user">
                <span>{{ auth.user.name }} &middot; {{ auth.user.role }}</span>
                <Link
                    v-if="auth.user.role === 'administrator'"
                    :href="adminUsers.url()"
                    class="hover:underline"
                >
                    Admin
                </Link>
                <Link :href="editProfile.url()" class="hover:underline">
                    Profile
                </Link>
                <Link
                    :href="storeLogout.url()"
                    method="post"
                    as="button"
                    class="hover:underline"
                >
                    Log out
                </Link>
            </template>
            <template v-else>
                <Link :href="login.url()" class="hover:underline">
                    Log in
                </Link>
                <Link :href="register.url()" class="hover:underline">
                    Register
                </Link>
            </template>
        </nav>
    </header>
</template>
