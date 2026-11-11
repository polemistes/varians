import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  effectiveConventions,
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
      apparatus: 'side',
      form: 'negative',
      interpretative: 'none',
      labels: 'every',
      underline: false,
      showMinor: true,
    });
    expect(parseSettings(stored)).toEqual({
      size: 'large',
      apparatus: 'side',
      form: 'negative',
      interpretative: 'none',
      labels: 'every',
      underline: false,
      showMinor: true,
    });
    // A choice stored before the apparatus stopped printing spellings is simply dropped.
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
        apparatus: 'top',
        form: 'both',
        labels: 7,
        underline: 'no',
        showMinor: 'yes',
      }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it('shows no print apparatus on screen by default, and keeps the placements stored before', () => {
    expect(DEFAULT_SETTINGS.apparatus).toBe('none');
    expect(parseSettings(null).apparatus).toBe('none');
    expect(parseSettings('{"apparatus":"foot"}').apparatus).toBe('foot');
    expect(parseSettings('{"apparatus":"side"}').apparatus).toBe('side');
    expect(parseSettings('{"apparatus":"none"}').apparatus).toBe('none');
    expect(parseSettings('{"apparatus":"margin"}').apparatus).toBe('none');
  });

  it('stores a chosen placement and nothing for the default', () => {
    expect(serializeSettings({ ...DEFAULT_SETTINGS, apparatus: 'foot' })).toBe(
      '{"apparatus":"foot"}',
    );
    expect(serializeSettings({ ...DEFAULT_SETTINGS, apparatus: 'none' })).toBe('{}');
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

describe('effectiveConventions', () => {
  const edition = { form: 'negative' as const, interpretative: 'separate' as const };
  it('follows the edition where the reader has not chosen', () => {
    expect(effectiveConventions(edition, DEFAULT_SETTINGS)).toEqual(edition);
  });
  it('puts the choices of form and of interpretative variants of the reader over it', () => {
    expect(effectiveConventions(edition, { ...DEFAULT_SETTINGS, form: 'positive' })).toEqual({
      form: 'positive',
      interpretative: 'separate',
    });
  });
  it('keeps how the edition names its witnesses', () => {
    const naming = {
      ...edition,
      groups: [{ siglum: 'p', members: ['V', 'H'] }],
      rest: 'cett.',
      all: 'codd.',
    };
    expect(effectiveConventions(naming, DEFAULT_SETTINGS)).toEqual(naming);
    expect(effectiveConventions(naming, { ...DEFAULT_SETTINGS, form: 'positive' })).toEqual({
      ...naming,
      form: 'positive',
    });
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
