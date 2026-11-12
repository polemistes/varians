import { describe, expect, it } from 'vitest';
import {
  NOT_TRANSCRIBED_ATTRS,
  fromText,
  sequentialIds,
  type Obj,
  type Stream,
} from '@varians/core';
import { buildDecorations, gapLabel, objectLabel } from './decorations.ts';
import { tooltipRows } from './editor.ts';
import { buildModel } from './model.ts';

const gap = (attrs: NonNullable<Obj['attrs']>): Obj => ({
  kind: 'object',
  id: 'g',
  type: 'gap',
  attrs,
});

describe('a gap in the text of the editor', () => {
  it('shows the brackets of a loss, with its extent when it has one', () => {
    expect(gapLabel(gap({ reason: 'lost' }))).toBe('[...]');
    expect(gapLabel(gap({ reason: 'lost', quantity: 4, unit: 'character' }))).toBe('[ca. 4]');
  });

  it('says "not transcribed" when it marks a stretch as such, whatever its extent', () => {
    expect(gapLabel(gap({ ...NOT_TRANSCRIBED_ATTRS }))).toBe('not transcribed');
    expect(gapLabel(gap({ ...NOT_TRANSCRIBED_ATTRS, quantity: 3, unit: 'line' }))).toBe(
      'not transcribed',
    );
    expect(objectLabel(gap({ ...NOT_TRANSCRIBED_ATTRS }))).toBe('not transcribed');
  });

  it('is told in its tooltip by its label, without the reason it is stored by', () => {
    const stream: Stream = fromText('a b', { lang: 'en', ids: sequentialIds() });
    const model = buildModel(stream, { form: 'written' });
    expect(tooltipRows(model, gap({ ...NOT_TRANSCRIBED_ATTRS }))).toEqual([
      ['not transcribed', ''],
    ]);
    expect(
      tooltipRows(model, gap({ ...NOT_TRANSCRIBED_ATTRS, quantity: 3, unit: 'line' })),
    ).toEqual([['not transcribed', 'quantity: 3, unit: line']]);
    expect(tooltipRows(model, gap({ reason: 'lost' }))).toEqual([['gap', 'reason: lost']]);
  });

  it('is drawn as a widget like any gap, labelled so', () => {
    const stream = fromText('a b', { lang: 'en', ids: sequentialIds() });
    stream.items.splice(1, 0, gap({ ...NOT_TRANSCRIBED_ATTRS }));
    const model = buildModel(stream, { form: 'written' });
    const decorations = buildDecorations(model, false);
    const labels: string[] = [];
    const cursor = decorations.iter();
    for (; cursor.value; cursor.next()) {
      const widget = (cursor.value.spec as { widget?: { label?: string } }).widget;
      if (widget?.label !== undefined) labels.push(widget.label);
    }
    expect(labels).toEqual(['not transcribed']);
  });
});
