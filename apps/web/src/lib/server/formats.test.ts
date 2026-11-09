import { describe, expect, it } from 'vitest';
import { contentTypeOf, isCurrentVersion, readFormatFile, resolveFormatFile, specification } from './formats.ts';

describe('the format files the site serves', () => {
  it('serves a schema at the address its $id names', async () => {
    const file = resolveFormatFile('work.schema.json');
    expect(file).not.toBeNull();
    const found = await readFormatFile(file!);
    expect(JSON.parse(found!.body.toString('utf8')).$id).toBe('https://varians.eu/formats/2/work.schema.json');
    expect(found!.type).toBe('application/schema+json; charset=utf-8');
  });

  it('serves the changelog and the specification, and nothing outside docs/formats', () => {
    expect(resolveFormatFile('CHANGELOG.md')).not.toBeNull();
    expect(resolveFormatFile('../guide.md')).toBeNull();
    expect(resolveFormatFile('schemas/../../guide.md')).toBeNull();
    expect(resolveFormatFile('.git/config')).toBeNull();
    expect(resolveFormatFile('make-schemas.py')).toBeNull();
    expect(resolveFormatFile('nonexistent.schema.json')).toBeNull();
    expect(contentTypeOf('varians.rng')).toBe('application/xml; charset=utf-8');
  });

  it('knows the current version only, and lists the schemas', async () => {
    expect(isCurrentVersion('2')).toBe(true);
    expect(isCurrentVersion('1')).toBe(false);
    const spec = await specification();
    expect(spec!.markdown).toContain('# Varians Data Format, version 2');
    expect(spec!.schemas).toContain('edition.schema.json');
  });
});
