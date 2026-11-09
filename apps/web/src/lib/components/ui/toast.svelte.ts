/**
 * Toasts: short confirmations after an action. The store is a module-level
 * rune so that any component or form handler can push; the Toaster in the
 * root layout shows them. The store reads its own state untracked, so that
 * pushing from inside an $effect does not make that effect depend on the
 * list and run again for every toast.
 */

import { untrack } from 'svelte';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Milliseconds before it disappears; 0 keeps it until dismissed. */
  duration: number;
}

const DURATIONS: Record<ToastKind, number> = { info: 5000, success: 4000, error: 8000 };

let sequence = 0;

class ToastStore {
  items = $state<Toast[]>([]);

  show(message: string, kind: ToastKind = 'info', duration = DURATIONS[kind]): number {
    const id = ++sequence;
    const current = untrack(() => this.items);
    this.items = [...current, { id, kind, message, duration }];
    return id;
  }

  info(message: string, duration?: number): number {
    return this.show(message, 'info', duration);
  }

  success(message: string, duration?: number): number {
    return this.show(message, 'success', duration);
  }

  error(message: string, duration?: number): number {
    return this.show(message, 'error', duration);
  }

  dismiss(id: number): void {
    const current = untrack(() => this.items);
    this.items = current.filter((toast) => toast.id !== id);
  }

  clear(): void {
    this.items = [];
  }
}

export const toasts = new ToastStore();
