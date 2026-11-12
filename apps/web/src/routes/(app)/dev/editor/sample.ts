/**
 * A sample stream for the editor's dev page: the opening of the Iliad on two
 * pages, the first in majuscule with read forms, the second in minuscule,
 * with a few marks, a gap, a word divided at a line's end and a segment start
 * per verse.
 */

import { sequentialIds, type Item, type Stream, type Token } from '@varians/core';

const verses: [string, string | null][] = [
  ['ΜΗΝΙΝ ΑΕΙΔΕ ΘΕΑ ΠΗΛΗΙΑΔΕΩ ΑΧΙΛΗΟΣ', 'μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος'],
  ['ΟΥΛΟΜΕΝΗΝ Η ΜΥΡΙ ΑΧΑΙΟΙΣ ΑΛΓΕ ΕΘΗΚΕ', 'οὐλομένην ἣ μυρί᾽ Ἀχαιοῖς ἄλγε᾽ ἔθηκε'],
  ['ΠΟΛΛΑΣ Δ ΙΦΘΙΜΟΥΣ ΨΥΧΑΣ ΑΙΔΙ ΠΡΟΙΑ|ΨΕΝ', 'πολλὰς δ᾽ ἰφθίμους ψυχὰς Ἄϊδι προΐα|ψεν'],
  ['+ΗΡΩΩΝ ΑΥΤΟΥΣ ΔΕ ΕΛΩΡΙΑ ΤΕΥΧΕ ΚΥΝΕΣΣΙΝ', '+ἡρώων αὐτοὺς δὲ ἑλώρια τεῦχε κύνεσσιν'],
  ['ΟΙΩΝΟΙΣΙ ΤΕ ΠΑΣΙ ΔΙΟΣ Δ ΕΤΕΛΕΙΕΤΟ ΒΟΥΛΗ', 'οἰωνοῖσί τε πᾶσι Διὸς δ᾽ ἐτελείετο βουλή'],
  ['ἐξ οὗ δὴ τὰ πρῶτα διαστήτην ἐρίσαντε', null],
  ['Ἀτρεΐδης τε ἄναξ ἀνδρῶν καὶ δῖος Ἀχιλλεύς', null],
  ['τίς τ᾽ ἄρ σφωε θεῶν ἔριδι ξυνέηκε μάχεσθαι', null],
  ['Λητοῦς καὶ Διὸς υἱός ὃ γὰρ βασιλῆϊ χολωθεὶς', null],
  ['νοῦσον ἀνὰ στρατὸν ὄρσε κακήν ὀλέκοντο δὲ λαοί', null],
];

export const segmentLabels: Record<string, string> = Object.fromEntries(
  verses.map((_, i) => [`il.1.${i + 1}`, `1.${i + 1}`]),
);

export const pageLabels: Record<string, string> = { 'p-12r': '12r', 'p-12v': '12v' };

export function sampleStream(): Stream {
  const ids = sequentialIds('s');
  const items: Item[] = [];
  const byForm = new Map<string, Token>();
  verses.forEach(([written, read], verse) => {
    const segmentId = `il.1.${verse + 1}`;
    // A verse beginning with a plus continues the previous line of the carrier.
    const continues = written.startsWith('+');
    if (verse === 0) items.push({ kind: 'break', id: ids(), type: 'page', pageId: 'p-12r' });
    else if (verse === 5) items.push({ kind: 'break', id: ids(), type: 'page', pageId: 'p-12v' });
    else if (!continues) items.push({ kind: 'break', id: ids(), type: 'line' });
    const writtenWords = written.replace(/^\+/, '').split(' ');
    const readWords = read ? read.replace(/^\+/, '').split(' ') : null;
    writtenWords.forEach((word, w) => {
      // A bar divides a word at the end of a line: the first half is joined with the second on the next line.
      const halves = word.split('|');
      halves.forEach((half, h) => {
        const token: Token = { kind: 'token', id: ids(), lang: 'grc', form: half };
        if (w === 0 && h === 0) token.segment = { segmentId };
        if (readWords) {
          const norm = readWords[w]!.split('|')[h]!;
          if (norm !== half) token.norm = norm;
        }
        if (h < halves.length - 1) token.joinNext = true;
        items.push(token);
        byForm.set(half, token);
        if (h < halves.length - 1) items.push({ kind: 'break', id: ids(), type: 'line' });
      });
    });
  });
  // Marks, an unchecked reading and a gap.
  byForm.get('ΜΥΡΙ')!.marks = [{ kind: 'unclear' }];
  byForm.get('ΕΘΗΚΕ')!.marks = [{ kind: 'supplied', attrs: { reason: 'lost' }, from: 0, to: 2 }];
  byForm.get('ΑΧΙΛΗΟΣ')!.unchecked = true;
  byForm.get('τε')!.marks = [{ kind: 'del', attrs: { rend: 'strikethrough' } }];
  byForm.get('ἄναξ')!.marks = [{ kind: 'add', attrs: { place: 'above' } }];
  byForm.get('θεῶν')!.marks = [{ kind: 'abbr', attrs: { expan: 'θεῶν' } }];
  byForm.get('Λητοῦς')!.marks = [{ kind: 'hi', attrs: { rend: 'rubric' } }];
  byForm.get('κακήν')!.marks = [{ kind: 'sic' }];
  byForm.get('ὄρσε')!.marks = [{ kind: 'damage', from: 1, to: 3 }];
  const dios = byForm.get('ΔΙΟΣ')!;
  const at = items.indexOf(dios);
  items.splice(at, 1, {
    kind: 'object',
    id: ids(),
    type: 'gap',
    attrs: { reason: 'lost', quantity: 4, unit: 'character' },
  });
  const last = byForm.get('λαοί')!;
  items.splice(items.indexOf(last) + 1, 0, {
    kind: 'object',
    id: ids(),
    type: 'note',
    text: 'a scholion stands in the margin',
  });
  return { items };
}
