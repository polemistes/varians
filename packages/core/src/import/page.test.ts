import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import { isToken } from '../stream/items.ts';
import { toText } from '../stream/text.ts';
import { lines, words } from '../stream/words.ts';
import { divideProportionally, importAltoXml, importPageXml } from './page.ts';

const page = `<?xml version="1.0" encoding="UTF-8"?>
<PcGts xmlns="http://schema.primaresearch.org/PAGE/gts/pagecontent/2013-07-15">
  <Metadata><Creator>Transkribus</Creator></Metadata>
  <Page imageFilename="folio_12r.jpg" imageWidth="1000" imageHeight="2000">
    <ReadingOrder>
      <OrderedGroup id="ro1">
        <RegionRefIndexed index="1" regionRef="r1"/>
        <RegionRefIndexed index="0" regionRef="r2"/>
      </OrderedGroup>
    </ReadingOrder>
    <TextRegion id="r1">
      <Coords points="0,1000 1000,1000 1000,1200 0,1200"/>
      <TextLine id="l3">
        <Coords points="100,1000 900,1000 900,1100 100,1100"/>
        <TextEquiv><Unicode>πολλὰς δ᾽ ἀλγε᾽</Unicode></TextEquiv>
      </TextLine>
    </TextRegion>
    <TextRegion id="r2">
      <TextLine id="l1">
        <Coords points="100,100 900,100 900,200 100,200"/>
        <Baseline points="100,190 900,190"/>
        <Word id="w1"><Coords points="100,100 300,100 300,200 100,200"/><TextEquiv><Unicode>μῆνιν</Unicode></TextEquiv></Word>
        <Word id="w2"><Coords points="320,100 600,100 600,200 320,200"/><TextEquiv><Unicode>ἄειδε</Unicode></TextEquiv></Word>
        <Word id="w3"><Coords points="620,100 900,100 900,200 620,200"/><TextEquiv><Unicode>θεὰ</Unicode></TextEquiv></Word>
        <TextEquiv><Unicode>μῆνιν ἄειδε θεὰ</Unicode></TextEquiv>
      </TextLine>
      <TextLine id="l2">
        <Coords points="100,300 900,300 900,400 100,400"/>
        <TextEquiv><Unicode>Πηληϊάδεω Ἀχιλῆος</Unicode></TextEquiv>
      </TextLine>
    </TextRegion>
    <ImageRegion id="i1"><Coords points="0,1500 1000,1500 1000,2000 0,2000"/></ImageRegion>
  </Page>
</PcGts>`;

describe('importPageXml', () => {
  it('gives pages, lines, words and zones in reading order', () => {
    const result = importPageXml(page, { ids: sequentialIds() });
    expect(result.warnings).toEqual([]);
    expect(result.pages).toEqual([{ label: 'folio_12r', imageFilename: 'folio_12r.jpg', width: 1000, height: 2000 }]);
    expect(result.stream.items[0]).toMatchObject({ kind: 'break', type: 'page', label: 'folio_12r' });
    expect(toText(result.stream)).toBe('\nμῆνιν ἄειδε θεὰ\nΠηληϊάδεω Ἀχιλῆος\nπολλὰς δ᾽ ἀλγε᾽');

    const wordZones = result.zones.filter((z) => z.tokenIds.length > 0);
    expect(wordZones.map((z) => z.text)).toEqual(['μῆνιν', 'ἄειδε', 'θεὰ', 'Πηληϊάδεω', 'Ἀχιλῆος', 'πολλὰς', 'δ᾽', 'ἀλγε᾽']);
    expect(wordZones[0]).toMatchObject({
      tokenIds: ['t2'],
      lineIndex: 1,
      geometry: { polygon: [[0.1, 0.05], [0.3, 0.05], [0.3, 0.1], [0.1, 0.1]] },
    });
    for (const zone of wordZones) {
      const line = lines(result.stream)[zone.lineIndex!]!;
      const token = result.stream.items.slice(line.from, line.to).find((i) => isToken(i) && i.id === zone.tokenIds[0]);
      expect(token).toBeDefined();
    }
  });

  it('divides a line without word coordinates in proportion to letter counts', () => {
    const result = importPageXml(page);
    const [first, second] = result.zones.filter((z) => z.text === 'Πηληϊάδεω' || z.text === 'Ἀχιλῆος');
    // 9 and 7 letters plus one space: 17 parts across 800 of 1000 pixels, from x = 100.
    expect(first?.geometry.rect?.x).toBeCloseTo(0.1, 5);
    expect(first?.geometry.rect?.w).toBeCloseTo((800 * 9) / 17 / 1000, 5);
    expect(first?.geometry.rect?.y).toBeCloseTo(0.15, 5);
    expect(first?.geometry.rect?.h).toBeCloseTo(0.05, 5);
    expect(second?.geometry.rect?.x).toBeCloseTo((100 + (800 * 10) / 17) / 1000, 5);
    expect(second?.geometry.rect?.w).toBeCloseTo((800 * 7) / 17 / 1000, 5);
  });

  it('keeps image regions as figure zones', () => {
    const result = importPageXml(page);
    const figure = result.zones.find((z) => z.feature?.kind === 'figure');
    expect(figure?.tokenIds).toEqual([]);
    expect(figure?.geometry.polygon?.[0]).toEqual([0, 0.75]);
  });

  it('divides a right-to-left line from the right', () => {
    const xml = `<PcGts><Page imageFilename="h.png" imageWidth="1000" imageHeight="100">
      <TextRegion id="r"><TextLine readingDirection="right-to-left">
        <Coords points="100,0 700,0 700,50 100,50"/>
        <TextEquiv><Unicode>אב גדה</Unicode></TextEquiv>
      </TextLine></TextRegion></Page></PcGts>`;
    const result = importPageXml(xml);
    expect(result.zones.map((z) => z.text)).toEqual(['אב', 'גדה']);
    expect(result.zones[0]?.geometry.rect).toEqual({ x: 0.5, y: 0, w: 0.2, h: 0.5 });
    expect(result.zones[1]?.geometry.rect).toEqual({ x: 0.1, y: 0, w: 0.3, h: 0.5 });
  });

  it('imports the text without zones when the page has no size, and warns', () => {
    const xml = `<PcGts><Page imageFilename="x.jpg"><TextRegion><TextLine>
      <Coords points="0,0 10,0 10,5 0,5"/><TextEquiv><Unicode>καὶ τοῦ</Unicode></TextEquiv>
    </TextLine></TextRegion></Page></PcGts>`;
    const result = importPageXml(xml);
    expect(result.stream.items.filter(isToken).map((t) => t.form)).toEqual(['καὶ', 'τοῦ']);
    expect(result.zones).toEqual([]);
    expect(result.warnings).toEqual(['Page x: no image size (imageWidth, imageHeight), so its zones are left out.']);
  });

  it('warns about words without coordinates and about broken XML', () => {
    const xml = `<PcGts><Page imageFilename="y.jpg" imageWidth="10" imageHeight="10"><TextRegion><TextLine>
      <TextEquiv><Unicode>καὶ τοῦ</Unicode></TextEquiv></TextLine></TextRegion></Page></PcGts>`;
    expect(importPageXml(xml).warnings).toEqual(['Page y: 2 words without coordinates, imported without a zone.']);
    expect(importPageXml('<PcGts><Page></PcGts>').warnings[0]).toMatch(/not well formed/u);
    expect(importPageXml('').warnings).toContain('No XML document found.');
  });
});

const alto = `<?xml version="1.0" encoding="UTF-8"?>
<alto xmlns="http://www.loc.gov/standards/alto/ns-v4#">
  <Description>
    <MeasurementUnit>mm10</MeasurementUnit>
    <sourceImageInformation><fileName>page_007.tif</fileName></sourceImageInformation>
  </Description>
  <Layout>
    <Page ID="p7" PHYSICAL_IMG_NR="7" WIDTH="2100" HEIGHT="2970">
      <PrintSpace HPOS="0" VPOS="0" WIDTH="2100" HEIGHT="2970">
        <TextBlock ID="b1">
          <TextLine HPOS="210" VPOS="297" WIDTH="1680" HEIGHT="60">
            <String CONTENT="ἄνδρα" HPOS="210" VPOS="297" WIDTH="420" HEIGHT="60"/>
            <SP WIDTH="42" HPOS="630" VPOS="297"/>
            <String CONTENT="μοι" HPOS="672" VPOS="297" WIDTH="252" HEIGHT="60">
              <Shape><Polygon POINTS="672,297 924,297 924,357 672,357"/></Shape>
            </String>
            <SP WIDTH="42" HPOS="924" VPOS="297"/>
            <String CONTENT="ἔννε" HPOS="966" VPOS="297" WIDTH="336" HEIGHT="60" SUBS_TYPE="HypPart1" SUBS_CONTENT="ἔννεπε"/>
            <HYP CONTENT="-"/>
          </TextLine>
          <TextLine HPOS="210" VPOS="400" WIDTH="1680" HEIGHT="60">
            <String CONTENT="πε" HPOS="210" VPOS="400" WIDTH="168" HEIGHT="60" SUBS_TYPE="HypPart2" SUBS_CONTENT="ἔννεπε"/>
            <String CONTENT="Μοῦσα πολύτροπον" HPOS="420" VPOS="400" WIDTH="1050" HEIGHT="60"/>
          </TextLine>
        </TextBlock>
      </PrintSpace>
    </Page>
  </Layout>
</alto>`;

describe('importAltoXml', () => {
  it('gives pages, lines, words and zones, joining hyphenated words', () => {
    const result = importAltoXml(alto, { ids: sequentialIds() });
    expect(result.warnings).toEqual([]);
    expect(result.pages).toEqual([{ label: 'page_007', imageFilename: 'page_007.tif', width: 2100, height: 2970 }]);
    expect(toText(result.stream)).toBe('\nἄνδρα μοι ἔννε\nπε Μοῦσα πολύτροπον');
    expect(words(result.stream).map((w) => w.form)).toEqual(['ἄνδρα', 'μοι', 'ἔννεπε', 'Μοῦσα', 'πολύτροπον']);
  });

  it('converts boxes and polygons to fractions of the page in the same unit', () => {
    const result = importAltoXml(alto);
    const [andra, moi] = result.zones;
    expect(andra?.geometry.rect?.x).toBeCloseTo(0.1, 5);
    expect(andra?.geometry.rect?.y).toBeCloseTo(0.1, 5);
    expect(andra?.geometry.rect?.w).toBeCloseTo(0.2, 5);
    expect(andra?.geometry.rect?.h).toBeCloseTo(60 / 2970, 5);
    expect(andra?.lineIndex).toBe(1);
    expect(moi?.geometry.polygon?.[0]?.[0]).toBeCloseTo(0.32, 5);
    expect(moi?.geometry.polygon?.[2]?.[1]).toBeCloseTo(357 / 2970, 5);
  });

  it('divides a String holding several words', () => {
    const result = importAltoXml(alto);
    const [mousa, polytropon] = result.zones.filter((z) => z.text === 'Μοῦσα' || z.text === 'πολύτροπον');
    // 5 and 10 letters plus one space: 16 parts across 1050 of 2100 units, from x = 420.
    expect(mousa?.geometry.rect?.x).toBeCloseTo(0.2, 5);
    expect(mousa?.geometry.rect?.w).toBeCloseTo((1050 * 5) / 16 / 2100, 5);
    expect(polytropon?.geometry.rect?.x).toBeCloseTo((420 + (1050 * 6) / 16) / 2100, 5);
  });

  it('labels pages by number when there is no file name, and warns without a size', () => {
    const xml = `<alto><Layout>
      <Page ID="p1" PHYSICAL_IMG_NR="3" WIDTH="100" HEIGHT="100"><PrintSpace><TextBlock><TextLine>
        <String CONTENT="a" HPOS="0" VPOS="0" WIDTH="10" HEIGHT="10"/></TextLine></TextBlock></PrintSpace></Page>
      <Page ID="p2"><PrintSpace><TextBlock><TextLine>
        <String CONTENT="b" HPOS="0" VPOS="0" WIDTH="10" HEIGHT="10"/></TextLine></TextBlock></PrintSpace></Page>
    </Layout></alto>`;
    const result = importAltoXml(xml);
    expect(result.pages.map((p) => p.label)).toEqual(['3', 'p2']);
    expect(result.zones).toHaveLength(1);
    expect(result.warnings).toEqual(['Page p2: no page size (WIDTH, HEIGHT), so its zones are left out.']);
  });
});

describe('divideProportionally', () => {
  it('shares a box by letter count with a letter between words', () => {
    const rects = divideProportionally({ x: 0, y: 0, w: 70, h: 10 }, ['καὶ', 'τοῦ']);
    expect(rects).toEqual([
      { x: 0, y: 0, w: 30, h: 10 },
      { x: 40, y: 0, w: 30, h: 10 },
    ]);
  });
});
