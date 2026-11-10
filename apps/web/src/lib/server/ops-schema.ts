/**
 * The shape of operations a client may send. The core applies
 * whatever it is given; this keeps malformed items, unknown fields and
 * oversized values out of the stored documents.
 */
import type { Op } from '@varians/core';
import { z } from 'zod';

const id = z.string().min(1).max(64);
const short = z.string().max(2000);
const attrValue = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);
const attrs = z
  .record(z.string().max(64), attrValue)
  .refine((value) => Object.keys(value).length <= 32, 'too many attributes');

const mark = z
  .object({
    kind: z.string().min(1).max(32),
    attrs: attrs.optional(),
    from: z.number().int().min(0).optional(),
    to: z.number().int().min(0).optional(),
  })
  .strict();

const segment = z
  .object({ segmentId: id.nullable(), part: z.number().int().min(1).max(1000).optional() })
  .strict();

const source = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('witness'), transcriptionId: id, tokenIds: z.array(id).max(64) })
    .strict(),
  z.object({ kind: z.literal('conjecture'), conjectureId: id }).strict(),
  z.object({ kind: z.literal('editor') }).strict(),
]);

const token = z
  .object({
    kind: z.literal('token'),
    id,
    form: short,
    norm: short.optional(),
    unchecked: z.boolean().optional(),
    joinNext: z.boolean().optional(),
    sep: z.enum(['space', 'none', 'interpunct', 'other']).optional(),
    segment: segment.optional(),
    marks: z.array(mark).max(32).optional(),
    source: source.optional(),
  })
  .strict();

const brk = z
  .object({
    kind: z.literal('break'),
    id,
    type: z.enum(['line', 'column', 'page', 'paragraph']),
    pageId: id.optional(),
    label: z.string().max(200).optional(),
    rend: z.string().max(64).optional(),
  })
  .strict();

const obj = z
  .object({
    kind: z.literal('object'),
    id,
    type: z.enum(['gap', 'figure', 'mark', 'note', 'lacuna', 'paratext', 'space']),
    attrs: attrs.optional(),
    text: z.string().max(20000).optional(),
    segment: segment.optional(),
  })
  .strict();

export const itemSchema = z.discriminatedUnion('kind', [token, brk, obj]);

/** The fields a `set` may change, by name; null removes a field. */
const settable: Record<string, z.ZodType> = {
  form: short,
  norm: short,
  unchecked: z.boolean(),
  joinNext: z.boolean(),
  sep: z.enum(['space', 'none', 'interpunct', 'other']),
  segment,
  marks: z.array(mark).max(32),
  source,
  type: z.string().max(32),
  pageId: id,
  label: z.string().max(200),
  rend: z.string().max(64),
  attrs,
  text: z.string().max(20000),
};

const fields = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  for (const [key, field] of Object.entries(value)) {
    const schema = Object.hasOwn(settable, key) ? settable[key] : undefined;
    if (!schema) {
      ctx.addIssue({ code: 'custom', message: `the field ${key} cannot be set` });
      continue;
    }
    if (field === null) continue;
    const parsed = schema.safeParse(field);
    if (!parsed.success) ctx.addIssue({ code: 'custom', message: `the field ${key} is malformed` });
  }
});

const items = z.array(itemSchema).max(100000);

export const opSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('insert'), after: id.nullable(), items }).strict(),
  z.object({ t: z.literal('delete'), ids: z.array(id).min(1).max(100000) }).strict(),
  z.object({ t: z.literal('set'), id, fields }).strict(),
  z
    .object({ t: z.literal('move'), ids: z.array(id).min(1).max(100000), after: id.nullable() })
    .strict(),
  z
    .object({
      t: z.literal('split'),
      id,
      at: z.number().int().min(1),
      newId: id,
      join: z.boolean().optional(),
    })
    .strict(),
  z.object({ t: z.literal('join'), id }).strict(),
  z.object({ t: z.literal('replace'), ids: z.array(id).min(1).max(100000), items }).strict(),
]);

export const opsSchema = z.array(opSchema).max(5000);

/** Parse operations from a request body; the message of the first problem when they are malformed. */
export function parseOps(value: unknown): { ok: true; ops: Op[] } | { ok: false; message: string } {
  const parsed = opsSchema.safeParse(value);
  if (parsed.success) return { ok: true, ops: parsed.data as unknown as Op[] };
  const issue = parsed.error.issues[0];
  return {
    ok: false,
    message: issue ? `${issue.path.join('.')}: ${issue.message}` : 'malformed operations',
  };
}

/** The segment ids operations name: segment starts of inserted items and of set fields. */
export function segmentIdsIn(ops: Op[]): string[] {
  const ids = new Set<string>();
  const take = (segment: unknown) => {
    if (
      segment &&
      typeof segment === 'object' &&
      'segmentId' in segment &&
      typeof segment.segmentId === 'string'
    )
      ids.add(segment.segmentId);
  };
  for (const op of ops) {
    if (op.t === 'insert' || op.t === 'replace')
      for (const item of op.items) if (item.kind !== 'break') take(item.segment);
    if (op.t === 'set') take(op.fields.segment);
  }
  return [...ids];
}
