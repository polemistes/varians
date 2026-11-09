import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  StoragePathError,
  dziPath,
  imageDir,
  originalPath,
  resolveStorageDir,
  safeJoin,
  tilesDir,
} from './storage';

describe('resolveStorageDir', () => {
  it('resolves a relative value against the working directory', () => {
    expect(resolveStorageDir('../../storage', '/srv/varians/apps/web')).toBe(
      '/srv/varians/storage',
    );
  });

  it('keeps an absolute value', () => {
    expect(resolveStorageDir('/var/lib/varians', '/anywhere')).toBe('/var/lib/varians');
  });

  it('falls back to ./storage when unset or blank', () => {
    expect(resolveStorageDir(undefined, '/srv/app/apps/web')).toBe('/srv/app/storage');
    expect(resolveStorageDir('  ', '/srv/app/apps/web')).toBe('/srv/app/storage');
  });
});

describe('page paths', () => {
  it('builds the original, tiles and dzi paths', () => {
    expect(originalPath('01HZX8K2M9Q7R3T5V6W8Y0A1B2', 'jpg')).toBe(
      'images/01HZX8K2M9Q7R3T5V6W8Y0A1B2/original.jpg',
    );
    expect(imageDir('p1')).toBe('images/p1');
    expect(tilesDir('p1')).toBe('tiles/p1');
    expect(dziPath('p1')).toBe('tiles/p1/image.dzi');
  });

  it('refuses ids and extensions with path syntax', () => {
    expect(() => originalPath('../etc', 'jpg')).toThrow(StoragePathError);
    expect(() => originalPath('a/b', 'jpg')).toThrow(StoragePathError);
    expect(() => originalPath('', 'jpg')).toThrow(StoragePathError);
    expect(() => originalPath('p1', 'jpg/..')).toThrow(StoragePathError);
    expect(() => originalPath('p1', 'JPG')).toThrow(StoragePathError);
    expect(() => tilesDir('p1\0')).toThrow(StoragePathError);
  });
});

describe('safeJoin', () => {
  const root = '/srv/storage';

  it('joins ordinary relative paths', () => {
    expect(safeJoin(root, 'tiles/p1/image.dzi')).toBe(path.join(root, 'tiles/p1/image.dzi'));
    expect(safeJoin(root, 'images/p1/original.jpg')).toBe(
      path.join(root, 'images/p1/original.jpg'),
    );
  });

  it('refuses traversal and absolute paths', () => {
    for (const bad of [
      '../secret',
      'tiles/../../secret',
      'tiles/p1/../../../etc/passwd',
      '/etc/passwd',
      'tiles//p1',
      './tiles/p1',
      'tiles/./p1',
      'tiles\\p1',
      'tiles/p1\0.jpg',
      '',
    ]) {
      expect(() => safeJoin(root, bad), bad).toThrow(StoragePathError);
    }
  });

  it('never returns the root itself', () => {
    expect(() => safeJoin(root, '.')).toThrow(StoragePathError);
  });
});
