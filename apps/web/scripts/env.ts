/**
 * Settings for the command-line scripts. The environment wins; then the file
 * named by VARIANS_ENV_FILE; then apps/web/.env. The same few lines serve the
 * scripts run from source (scripts/) and bundled (build/scripts/), so the app
 * directory is found by walking up to the nearest package.json.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Parses KEY=value lines; values may be quoted with double or single quotes. Pure. */
export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line);
    if (!match) continue;
    const raw = match[2]!;
    const quoted = /^"(.*)"$/u.exec(raw) ?? /^'(.*)'$/u.exec(raw);
    values[match[1]!] = quoted ? quoted[1]! : raw.replace(/\s+#.*$/u, '');
  }
  return values;
}

/** The directory of the @varians/web package, from a module inside it. */
export function appDir(from: string = import.meta.url): string {
  let dir = path.dirname(fileURLToPath(from));
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Fills process.env from the settings file, without overriding what is set. */
export function loadEnv(): void {
  const file = process.env.VARIANS_ENV_FILE || path.join(appDir(), '.env');
  if (!existsSync(file)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** A connection string fit for a log: without the password. */
export function redactUrl(url: string): string {
  return url.replace(/\/\/([^@/]*)@/u, (_, credentials: string) => `//${credentials.split(':')[0]}@`);
}
