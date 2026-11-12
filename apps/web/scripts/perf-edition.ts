/** Time the edition view of a long synthetic work (LINES=600 by default, three witnesses) against the test database; everything made is removed. Run: pnpm --filter @varians/web exec tsx scripts/perf-edition.ts */
import { fromText, newId, SCHEME_PRESETS, type Item, type Stream, type Token } from '@varians/core';
import {
  createDatabase,
  referenceSchemes,
  transcriptions,
  users,
  witnesses,
  works,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { createEdition } from '../src/lib/server/editions.ts';
import { editionView, segmentViewsFor } from '../src/lib/server/reader.ts';
import { replaceContent } from '../src/lib/server/documents/service.ts';
import { resolveLabels, schemeOfWork } from '../src/lib/server/segments.ts';

const LINES = Number(process.env.LINES ?? 600);
const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
const { db, pool } = createDatabase(url);
let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const VOCAB =
  'μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος οὐλομένην ἣ μυρί Ἀχαιοῖς ἄλγε ἔθηκε πολλὰς δ ἰφθίμους ψυχὰς Ἄϊδι προΐαψεν ἡρώων αὐτοὺς δὲ ἑλώρια τεῦχε κύνεσσιν οἰωνοῖσί τε πᾶσι Διὸς ἐτελείετο βουλή ἐξ οὗ δὴ τὰ πρῶτα διαστήτην ἐρίσαντε Ἀτρεΐδης ἄναξ ἀνδρῶν καὶ δῖος Ἀχιλλεύς τίς τ ἄρ σφωε θεῶν ἔριδι ξυνέηκε μάχεσθαι Λητοῦς υἱός ὁ γὰρ βασιλῆϊ χολωθεὶς νοῦσον ἀνὰ στρατὸν ὄρσε κακήν ὀλέκοντο λαοί'.split(
    ' ',
  );
const v0 = (view: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(view).filter(([k]) => k !== 'segments'));
const word = () => VOCAB[Math.floor(rand() * VOCAB.length)]!;

const owner = newId();
const tag = newId().slice(-6).toLowerCase();
const workSlug = `perf-${tag}`;
const witnessIds: string[] = [];

function streamOf(lines: Map<string, string[]>, segmentIdOf: (l: string) => string): Stream {
  const items: Item[] = [];
  let first = true;
  for (const [label, words] of lines) {
    if (!first) items.push({ kind: 'break', id: newId(), type: 'line' });
    first = false;
    const line = fromText(words.join(' '), { lang: 'grc' });
    (line.items[0] as Token).segment = { segmentId: segmentIdOf(label) };
    items.push(...line.items);
  }
  return { items };
}

try {
  await db
    .insert(users)
    .values({ id: owner, email: `${owner}@test`, name: 'Perf', passwordHash: 'x' });
  const schemeId = newId();
  await db.insert(referenceSchemes).values({
    id: schemeId,
    name: 'Book and line',
    levels: SCHEME_PRESETS[0]!.scheme.levels,
    createdBy: owner,
  });
  const workId = newId();
  await db.insert(works).values({
    id: workId,
    slug: workSlug,
    title: 'Perf',
    schemeId,
    createdBy: owner,
  });
  const scheme = await schemeOfWork(db, workId);
  const labels = Array.from({ length: LINES }, (_, i) => `1.${i + 1}`);
  let t = performance.now();
  const map = await resolveLabels(db, scheme, labels);
  console.log(`segments: ${(performance.now() - t).toFixed(0)} ms`);
  const segmentIdOf = (l: string) => map.get(l)!.id;
  const base = new Map(
    labels.map((l) => [l, Array.from({ length: 6 + Math.floor(rand() * 4) }, word)]),
  );
  const sigla: { witnessId: string; transcriptionId: string; siglum: string }[] = [];
  for (const siglum of ['A', 'B', 'C']) {
    const lines = new Map<string, string[]>();
    for (const [label, words] of base) {
      if (siglum !== 'A' && rand() < 0.01) continue; // a missing line
      const w = [...words];
      if (siglum !== 'A') {
        if (rand() < 0.2) w[Math.floor(rand() * w.length)] = word();
        if (rand() < 0.05) w.splice(Math.floor(rand() * w.length), 1);
        if (rand() < 0.05) w.splice(Math.floor(rand() * w.length), 0, word());
        if (rand() < 0.03 && w.length > 2) {
          const i = Math.floor(rand() * (w.length - 1));
          [w[i], w[i + 1]] = [w[i + 1]!, w[i]!];
        }
      }
      lines.set(label, w);
    }
    const witnessId = newId();
    witnessIds.push(witnessId);
    await db.insert(witnesses).values({
      id: witnessId,
      slug: `perf-${siglum.toLowerCase()}-${tag}`,
      siglum,
      name: `Perf ${siglum}`,
      createdBy: owner,
    });
    const transcriptionId = newId();
    await db
      .insert(transcriptions)
      .values({ id: transcriptionId, witnessId, workId, name: 'Perf', ownerId: owner });
    await replaceContent(
      db,
      'transcription',
      transcriptionId,
      owner,
      0,
      streamOf(lines, segmentIdOf),
      'perf',
    );
    sigla.push({ witnessId, transcriptionId, siglum });
  }
  t = performance.now();
  const edition = await createEdition(
    db,
    { workId, title: `Perf ${tag}`, baseTranscriptionId: sigla[0]!.transcriptionId, sigla },
    owner,
  );
  console.log(`create edition: ${(performance.now() - t).toFixed(0)} ms`);
  t = performance.now();
  const view = await editionView(db, edition.id);
  console.log(
    `editionView cold: ${(performance.now() - t).toFixed(0)} ms, ${view.lines.length} lines, ${Object.values(view.segments).reduce((n, s) => n + s.collation.sites.length, 0)} sites`,
  );
  t = performance.now();
  await editionView(db, edition.id);
  console.log(`editionView warm: ${(performance.now() - t).toFixed(0)} ms`);
  const json = JSON.stringify(view);
  console.log(`view JSON: ${(json.length / 1024 / 1024).toFixed(1)} MB`);
  const light = JSON.stringify({
    ...view,
    segments: Object.fromEntries(
      Object.entries(view.segments).map(([id, v]) => [
        id,
        { ...v, collation: { ...v.collation, columns: [] } },
      ]),
    ),
  });
  console.log(
    `edit page view without alignment columns: ${(light.length / 1024 / 1024).toFixed(1)} MB`,
  );
  const sizes: Record<string, number> = {};
  for (const v of Object.values(view.segments))
    for (const [k, x] of Object.entries(v)) sizes[k] = (sizes[k] ?? 0) + JSON.stringify(x).length;
  for (const [k, x] of Object.entries(v0(view))) sizes['view.' + k] = JSON.stringify(x).length;
  console.log(
    Object.entries(sizes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, n]) => `${k} ${(n / 1024).toFixed(0)} KB`)
      .join(', '),
  );
  const c0 = Object.values(view.segments)[0]!.collation as unknown as Record<string, unknown>;
  console.log(
    'collation keys:',
    Object.entries(c0)
      .map(([k, x]) => `${k} ${(JSON.stringify(x).length / 1024).toFixed(1)}KB`)
      .join(', '),
  );
  t = performance.now();
  const ids = Object.keys(view.segments).slice(100, 103);
  await segmentViewsFor(db, edition.id, ids);
  console.log(`segmentViewsFor 3: ${(performance.now() - t).toFixed(0)} ms`);
} finally {
  await db.delete(works).where(eq(works.slug, workSlug));
  if (witnessIds.length) await db.delete(witnesses).where(inArray(witnesses.id, witnessIds));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, owner));
  await db.delete(users).where(eq(users.id, owner));
  await pool.end();
}
