import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  isDefault,
  loadSettings,
  parseSettings,
  saveSettings,
  serializeSettings,
} from './settings';

describe('parseSettings', () => {
  it('reads what was stored', () => {
    const stored = JSON.stringify({
      size: 'large',
      labels: 'every',
      underline: false,
      showInterpretative: false,
      showMinor: true,
    });
    expect(parseSettings(stored)).toEqual({
      size: 'large',
      labels: 'every',
      underline: false,
      showInterpretative: false,
      showMinor: true,
    });
    // A choice stored for something the reader no longer has is simply dropped.
    expect(parseSettings(JSON.stringify({ size: 'large', orthographica: true }))).toEqual({
      ...DEFAULT_SETTINGS,
      size: 'large',
    });
  });

  it('falls back to the defaults for nothing, broken JSON and values it does not know', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2]')).toEqual(DEFAULT_SETTINGS);
    expect(
      parseSettings({
        size: 'huge',
        labels: 7,
        underline: 'no',
        showInterpretative: 'no',
        showMinor: 'yes',
      }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it('shows the interpretative variants by default, and stores the choice not to', () => {
    expect(DEFAULT_SETTINGS.showInterpretative).toBe(true);
    expect(parseSettings(null).showInterpretative).toBe(true);
    expect(serializeSettings({ ...DEFAULT_SETTINGS, showInterpretative: false })).toBe(
      '{"showInterpretative":false}',
    );
    expect(parseSettings('{"showInterpretative":false}').showInterpretative).toBe(false);
    expect(serializeSettings({ ...DEFAULT_SETTINGS, showInterpretative: true })).toBe('{}');
  });

  it('gives a reader who remembers the old choices the page without a print apparatus', () => {
    // Where the print apparatus stood, and its form, are no longer choices: they read as the defaults.
    for (const apparatus of ['none', 'foot', 'side', 'margin']) {
      for (const form of ['positive', 'negative']) {
        const old = JSON.stringify({ size: 'small', apparatus, form });
        expect(parseSettings(old)).toEqual({ ...DEFAULT_SETTINGS, size: 'small' });
      }
    }
    // Interpretative variants set in a list of their own, or among the others, are shown; not shown stays so.
    expect(parseSettings('{"interpretative":"apparatus"}').showInterpretative).toBe(true);
    expect(parseSettings('{"interpretative":"separate"}').showInterpretative).toBe(true);
    expect(parseSettings('{"interpretative":"none"}').showInterpretative).toBe(false);
    expect(parseSettings('{"interpretative":"sideways"}').showInterpretative).toBe(true);
    // The new choice wins over an old one stored beside it.
    expect(
      parseSettings('{"interpretative":"none","showInterpretative":true}').showInterpretative,
    ).toBe(true);
    // Saving them again stores nothing of what is gone.
    expect(serializeSettings(parseSettings('{"apparatus":"foot","form":"negative"}'))).toBe('{}');
    expect(serializeSettings(parseSettings('{"interpretative":"none","apparatus":"side"}'))).toBe(
      '{"showInterpretative":false}',
    );
  });

  it('does not show the minor variants by default, and stores the choice to show them', () => {
    expect(DEFAULT_SETTINGS.showMinor).toBe(false);
    expect(parseSettings(null).showMinor).toBe(false);
    expect(serializeSettings({ ...DEFAULT_SETTINGS, showMinor: true })).toBe('{"showMinor":true}');
    expect(parseSettings('{"showMinor":true}').showMinor).toBe(true);
  });

  it('keeps the valid fields of a partly valid object', () => {
    expect(parseSettings({ size: 'small', form: 'sideways' })).toEqual({
      ...DEFAULT_SETTINGS,
      size: 'small',
    });
  });
});

describe('serializeSettings', () => {
  it('stores only what differs from the defaults, and reads back the same', () => {
    expect(serializeSettings(DEFAULT_SETTINGS)).toBe('{}');
    expect(isDefault(DEFAULT_SETTINGS)).toBe(true);
    const changed = { ...DEFAULT_SETTINGS, size: 'small' as const, labels: 'every' as const };
    expect(JSON.parse(serializeSettings(changed))).toEqual({ size: 'small', labels: 'every' });
    expect(parseSettings(serializeSettings(changed))).toEqual(changed);
    expect(isDefault(changed)).toBe(false);
  });
});

describe('loadSettings and saveSettings', () => {
  function memory() {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    };
  }

  it('round-trips through storage and removes the entry for the defaults', () => {
    const storage = memory();
    saveSettings(storage, { ...DEFAULT_SETTINGS, labels: 'every' });
    expect(storage.map.get(SETTINGS_KEY)).toBe('{"labels":"every"}');
    expect(loadSettings(storage)).toEqual({ ...DEFAULT_SETTINGS, labels: 'every' });
    saveSettings(storage, DEFAULT_SETTINGS);
    expect(storage.map.has(SETTINGS_KEY)).toBe(false);
  });

  it('survives storage that is missing or refuses access', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(refusing)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(refusing, { ...DEFAULT_SETTINGS, size: 'large' })).not.toThrow();
  });
});
