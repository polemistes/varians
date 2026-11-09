/**
 * The licence check of CI: every production dependency must be under a
 * licence that can be combined with the AGPL-3.0-or-later of Varians. Reads
 * `pnpm licenses list --json --prod` (or a file of its output given as the
 * argument), and fails on a licence that is not on the list below, and on a
 * package whose licence is unknown.
 *
 *   pnpm --filter @varians/web exec tsx scripts/check-licences.ts [report.json]
 *
 * A licence is added to ALLOWED only when it is compatible with the AGPL-3.0
 * (the FSF's list of GPL-compatible licences is the reference); a single
 * package with an unusual statement goes into PACKAGE_EXCEPTIONS with the
 * reason it may be used.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Licences that may be combined with AGPL-3.0-or-later code (SPDX identifiers). */
export const ALLOWED = new Set([
  '0BSD',
  'AGPL-3.0-or-later',
  'Apache-2.0',
  'Artistic-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC-BY-4.0',
  'CC0-1.0',
  'GPL-3.0-or-later',
  'ISC',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
  'Zlib',
]);

/** Exceptions (SPDX `WITH`) that only widen what the licence allows. */
export const ALLOWED_EXCEPTIONS = new Set(['LLVM-exception', 'Classpath-exception-2.0']);

/** Single packages allowed despite their stated licence, with the reason. Keyed by name. */
export const PACKAGE_EXCEPTIONS: Record<string, string> = {};

/** Older and looser spellings found in package.json files, and what they mean. */
const ALIASES: Record<string, string> = {
  'Apache 2.0': 'Apache-2.0',
  'Apache License 2.0': 'Apache-2.0',
  BSD: 'BSD-3-Clause',
  'GPL-3.0+': 'GPL-3.0-or-later',
  'LGPL-2.1+': 'LGPL-2.1-or-later',
  'LGPL-3.0+': 'LGPL-3.0-or-later',
  'AGPL-3.0+': 'AGPL-3.0-or-later',
};

type Node = { op: 'or' | 'and'; left: Node; right: Node } | { op: 'id'; id: string; exception?: string };

class ParseError extends Error {}

/** Parses an SPDX licence expression: identifiers, WITH, AND, OR and parentheses. */
export function parseExpression(expression: string): Node {
  const tokens = expression.replace(/\(/gu, ' ( ').replace(/\)/gu, ' ) ').trim().split(/\s+/u).filter(Boolean);
  let at = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];

  function atom(): Node {
    const token = next();
    if (token === undefined) throw new ParseError('unexpected end');
    if (token === '(') {
      const inner = or();
      if (next() !== ')') throw new ParseError('missing )');
      return inner;
    }
    if (/^(and|or|with|\))$/iu.test(token)) throw new ParseError(`unexpected ${token}`);
    if (peek()?.toUpperCase() === 'WITH') {
      next();
      const exception = next();
      if (!exception) throw new ParseError('missing exception');
      return { op: 'id', id: token, exception };
    }
    return { op: 'id', id: token };
  }
  function and(): Node {
    let left = atom();
    while (peek()?.toUpperCase() === 'AND') {
      next();
      left = { op: 'and', left, right: atom() };
    }
    return left;
  }
  function or(): Node {
    let left = and();
    while (peek()?.toUpperCase() === 'OR') {
      next();
      left = { op: 'or', left, right: and() };
    }
    return left;
  }

  const tree = or();
  if (at !== tokens.length) throw new ParseError(`unexpected ${tokens[at]}`);
  return tree;
}

function allowedNode(node: Node): boolean {
  if (node.op === 'or') return allowedNode(node.left) || allowedNode(node.right);
  if (node.op === 'and') return allowedNode(node.left) && allowedNode(node.right);
  const id = ALIASES[node.id] ?? node.id;
  return ALLOWED.has(id) && (node.exception === undefined || ALLOWED_EXCEPTIONS.has(node.exception));
}

/** Whether a licence statement allows use in Varians. Unknown or unparseable statements do not. */
export function licenceAllowed(statement: string | undefined | null): boolean {
  const text = (statement ?? '').trim();
  if (!text || /^(unknown|unlicensed|see licen[cs]e in)/iu.test(text)) return false;
  if (ALIASES[text]) return ALLOWED.has(ALIASES[text]!);
  try {
    return allowedNode(parseExpression(text));
  } catch {
    return false;
  }
}

export interface ReportedPackage {
  name: string;
  versions?: string[];
  license?: string;
}

/** The output of `pnpm licenses list --json`: packages grouped by licence. */
export type LicenceReport = Record<string, ReportedPackage[]>;

export interface Problem {
  name: string;
  versions: string[];
  licence: string;
}

/** The packages whose licence is not allowed, in name order. */
export function licenceProblems(report: LicenceReport): Problem[] {
  const problems: Problem[] = [];
  for (const [group, packages] of Object.entries(report)) {
    for (const pkg of packages) {
      const licence = pkg.license ?? group;
      if (PACKAGE_EXCEPTIONS[pkg.name] || licenceAllowed(licence)) continue;
      problems.push({ name: pkg.name, versions: pkg.versions ?? [], licence: licence || 'Unknown' });
    }
  }
  return problems.sort((a, b) => a.name.localeCompare(b.name));
}

function main(): void {
  const given = process.argv[2];
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const text = given
    ? readFileSync(given, 'utf8')
    : execFileSync('pnpm', ['licenses', 'list', '--json', '--prod'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const report = JSON.parse(text) as LicenceReport;
  const count = Object.values(report).reduce((n, list) => n + list.length, 0);
  const problems = licenceProblems(report);
  for (const [licence, packages] of Object.entries(report).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${licence}: ${packages.length}`);
  }
  if (problems.length > 0) {
    console.error(`\n${problems.length} production ${problems.length === 1 ? 'dependency has' : 'dependencies have'} a licence not known to be compatible with AGPL-3.0-or-later:`);
    for (const p of problems) console.error(`  ${p.name}@${p.versions.join(', ')}: ${p.licence}`);
    console.error('\nReplace the dependency, or, after checking its licence, add the licence to ALLOWED or the package to PACKAGE_EXCEPTIONS in apps/web/scripts/check-licences.ts.');
    process.exit(1);
  }
  console.log(`\nAll ${count} production dependencies have licences compatible with AGPL-3.0-or-later.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
