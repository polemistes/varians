import type { User } from '@/types/auth';

export function isEditorOrAbove(user: User | null): boolean {
    return user?.role === 'editor' || user?.role === 'administrator';
}

export function isAdministrator(user: User | null): boolean {
    return user?.role === 'administrator';
}
