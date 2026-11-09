/**
 * Validation of archive files against the JSON Schemas of the format
 * (docs/formats/schemas, Varians Data Format 2). Every JSON file names its
 * schema in `$schema`; every line of history.ndjson is a changeset.
 */

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { FORMAT_BASE, formatsDir } from './archive.ts';

export interface ValidationProblem {
  file: string;
  message: string;
}

let compiled: Promise<Ajv2020> | null = null;

/** The schemas, loaded once from docs/formats/schemas. */
async function schemas(): Promise<Ajv2020> {
  compiled ??= (async () => {
    const dir = formatsDir();
    if (!dir) throw new Error('docs/formats not found: cannot validate archives');
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    const schemaDir = path.join(dir, 'schemas');
    for (const name of (await readdir(schemaDir)).filter((n) => n.endsWith('.schema.json')).sort()) {
      ajv.addSchema(JSON.parse(await readFile(path.join(schemaDir, name), 'utf8')));
    }
    return ajv;
  })();
  return compiled;
}

function describe(validate: ValidateFunction): string {
  return (validate.errors ?? [])
    .slice(0, 5)
    .map((e) => `${e.instancePath || '/'} ${e.message ?? 'is not valid'}`)
    .join('; ');
}

async function filesUnder(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    if (entry.name === '.git' || (prefix === '' && entry.name === 'schemas')) continue;
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(dir, rel)));
    else out.push(rel);
  }
  return out;
}

/** Validate every JSON and NDJSON file of an archive directory. Returns the problems found; none means valid. */
export async function validateArchiveDir(dir: string): Promise<ValidationProblem[]> {
  const ajv = await schemas();
  const problems: ValidationProblem[] = [];
  const changeset = ajv.getSchema(`${FORMAT_BASE}changeset.schema.json`);
  if (!changeset) throw new Error('the changeset schema is missing');
  for (const file of await filesUnder(dir)) {
    const full = path.join(dir, file);
    if (file.endsWith('.ndjson')) {
      const lines = (await readFile(full, 'utf8')).split('\n').filter((l) => l.trim() !== '');
      lines.forEach((line, i) => {
        let data: unknown;
        try {
          data = JSON.parse(line);
        } catch {
          problems.push({ file: `${file}:${i + 1}`, message: 'is not JSON' });
          return;
        }
        if (!changeset(data)) problems.push({ file: `${file}:${i + 1}`, message: describe(changeset) });
      });
      continue;
    }
    if (!file.endsWith('.json') || path.basename(file) === 'ro-crate-metadata.json') continue;
    let data: unknown;
    try {
      data = JSON.parse(await readFile(full, 'utf8'));
    } catch {
      problems.push({ file, message: 'is not JSON' });
      continue;
    }
    const id = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>).$schema : undefined;
    if (typeof id !== 'string') {
      problems.push({ file, message: 'names no schema in $schema' });
      continue;
    }
    if (Object.keys(data as object)[0] !== '$schema') problems.push({ file, message: '$schema is not the first member' });
    const validate = ajv.getSchema(id);
    if (!validate) {
      problems.push({ file, message: `names an unknown schema ${id}` });
      continue;
    }
    if (!validate(data)) problems.push({ file, message: describe(validate) });
  }
  return problems;
}
