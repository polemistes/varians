import { afterEach, describe, expect, it } from 'vitest';
import { PaneSize } from './pane-size.svelte.ts';

function fakeWindow(innerHeight = 1000) {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  (globalThis as { window?: unknown }).window = { localStorage, innerHeight };
  return store;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('PaneSize', () => {
  it('keeps sizes within limits and starts from the fallback', () => {
    const pane = new PaneSize('t', { min: 100, max: 500, fallback: 300 });
    expect(pane.value).toBe(300);
    expect(pane.clamp(20)).toBe(100);
    expect(pane.clamp(900)).toBe(500);
  });

  it('remembers a size, restores it, and forgets it on reset', () => {
    const store = fakeWindow(1000);
    const pane = new PaneSize('band', { min: 100, max: 800, fallback: 300, initial: () => window.innerHeight * 0.3 });
    pane.restore();
    expect(pane.value).toBe(300);
    pane.set(450.4);
    expect(store.get('varians.pane.band')).toBe('450');
    const again = new PaneSize('band', { min: 100, max: 800, fallback: 300 });
    again.restore();
    expect(again.value).toBe(450);
    pane.reset();
    expect(store.has('varians.pane.band')).toBe(false);
    expect(pane.value).toBe(300);
  });

  it('ignores what it cannot read, and works without storage', () => {
    const store = fakeWindow();
    store.set('varians.pane.x', 'wide');
    const pane = new PaneSize('x', { min: 100, max: 800, fallback: 250 });
    pane.restore();
    expect(pane.value).toBe(250);
    delete (globalThis as { window?: unknown }).window;
    expect(() => pane.set(300)).not.toThrow();
    expect(pane.value).toBe(300);
  });
});
