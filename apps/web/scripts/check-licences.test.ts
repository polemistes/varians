import { describe, expect, it } from 'vitest';
import { licenceAllowed, licenceProblems, parseExpression } from './check-licences.ts';

describe('licence statements', () => {
  it('allow the permissive and weak copyleft licences in use', () => {
    for (const id of [
      'MIT',
      'MIT-0',
      'ISC',
      'BSD-2-Clause',
      'BSD-3-Clause',
      '0BSD',
      'Apache-2.0',
      'MPL-2.0',
      'LGPL-3.0-or-later',
    ]) {
      expect(licenceAllowed(id), id).toBe(true);
    }
  });

  it('refuse licences incompatible with the AGPL-3.0', () => {
    for (const id of [
      'GPL-2.0-only',
      'CC-BY-NC-4.0',
      'CC-BY-ND-4.0',
      'SSPL-1.0',
      'BUSL-1.1',
      'EPL-1.0',
      'CDDL-1.0',
      'JSON',
      'Proprietary',
    ]) {
      expect(licenceAllowed(id), id).toBe(false);
    }
  });

  it('refuse what is unknown or unstated', () => {
    expect(licenceAllowed('Unknown')).toBe(false);
    expect(licenceAllowed('UNLICENSED')).toBe(false);
    expect(licenceAllowed('SEE LICENSE IN LICENSE.md')).toBe(false);
    expect(licenceAllowed('')).toBe(false);
    expect(licenceAllowed(undefined)).toBe(false);
    expect(licenceAllowed('(MIT')).toBe(false);
  });

  it('read SPDX expressions: OR needs one side, AND both, WITH a known exception', () => {
    expect(licenceAllowed('(MIT OR Apache-2.0)')).toBe(true);
    expect(licenceAllowed('MIT OR GPL-2.0-only')).toBe(true);
    expect(licenceAllowed('MIT AND GPL-2.0-only')).toBe(false);
    expect(licenceAllowed('(MIT AND Zlib) OR SSPL-1.0')).toBe(true);
    expect(licenceAllowed('Apache-2.0 WITH LLVM-exception')).toBe(true);
    expect(licenceAllowed('GPL-2.0-only WITH Classpath-exception-2.0')).toBe(false);
    expect(licenceAllowed('MIT WITH Some-unknown-exception')).toBe(false);
    expect(licenceAllowed('LGPL-3.0+')).toBe(true);
  });

  it('parse with AND binding tighter than OR', () => {
    expect(parseExpression('A OR B AND C')).toEqual({
      op: 'or',
      left: { op: 'id', id: 'A' },
      right: { op: 'and', left: { op: 'id', id: 'B' }, right: { op: 'id', id: 'C' } },
    });
  });
});

describe('the report of pnpm', () => {
  it('names each package whose licence is not allowed', () => {
    const report = {
      MIT: [{ name: 'fine', versions: ['1.0.0'], license: 'MIT' }],
      'GPL-2.0-only': [{ name: 'too-strict', versions: ['2.0.0'], license: 'GPL-2.0-only' }],
      Unknown: [{ name: 'mystery', versions: ['0.1.0'] }],
      '(MIT OR CC0-1.0)': [{ name: 'dual', versions: ['3.0.0'], license: '(MIT OR CC0-1.0)' }],
    };
    expect(licenceProblems(report)).toEqual([
      { name: 'mystery', versions: ['0.1.0'], licence: 'Unknown' },
      { name: 'too-strict', versions: ['2.0.0'], licence: 'GPL-2.0-only' },
    ]);
  });
});
