/**
 * Where the Greek forms and dictionaries come from. A build reads them from
 * the sources directory: in a checkout apps/web/lexicon-sources/ (not in
 * git; the owner's copy of the Anagnosis pipeline's cache), otherwise a
 * temporary one. What is not there is downloaded, from commits pinned so
 * that a build from downloads is the same everywhere; the Middle Liddell
 * from a mirror, since the Perseus hopper no longer serves the tarball that
 * held it. A file already in the directory is used as it is.
 *
 *   lsj/grc.lsj.perseus-eng1.xml … eng27.xml   Liddell, Scott and Jones, TEI P5, Perseus Digital Library, CC BY-SA 4.0
 *   middle-liddell.xml                         Liddell and Scott's Intermediate lexicon, TEI P4, Perseus Digital Library, CC BY-SA 3.0 US
 *   treebanks/<text>.tb.xml                    the Ancient Greek Dependency Treebank, version 2.1, CC BY-SA 3.0 US
 *   morpheus-analyses.tsv.gz                   the analyses of Morpheus, made by the Anagnosis pipeline (not downloadable; see docs/lexicon.md)
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { appDir } from '../env.ts';
const RAW = 'https://raw.githubusercontent.com';

/** PerseusDL/lexica, the LSJ in 27 files. */
export const LEXICA_COMMIT = '1c34cdf756c63cf37db61bd366d733431dbd7aa0'; // 2026-10-26
/** PerseusDL/treebank_data, version 2.1 of the Greek treebank. */
export const TREEBANK_COMMIT = 'bf4334f0af5e13d16b04c1cccd6237e683ac6f5f'; // 2024-06-19
/**
 * blinskey/middle-liddell: the Perseus XML of the Middle Liddell as the
 * hopper exported it (its default attributes written out, its entities
 * resolved), with a few typographical corrections of the mirror's own.
 */
export const MIDDLE_LIDDELL_COMMIT = '5db8d88a20066e182ca3fc6ee758c9f61ac60603'; // 2026-10-12
export const MIDDLE_LIDDELL_SHA256 =
  '1b0e2ed672ac23399fbdb031b06119e7736ccefc78c229f6c9302b7c6348c811';

export const LSJ_FILES = Array.from({ length: 27 }, (_, i) => `grc.lsj.perseus-eng${i + 1}.xml`);
export const MIDDLE_LIDDELL_FILE = 'middle-liddell.xml';
export const TREEBANK_FILES = [
  'tlg0003.tlg001.perseus-grc1.1.tb.xml',
  'tlg0007.tlg004.perseus-grc1.tb.xml',
  'tlg0007.tlg015.perseus-grc1.tb.xml',
  'tlg0008.tlg001.perseus-grc1.12.tb.xml',
  'tlg0008.tlg001.perseus-grc1.13.tb.xml',
  'tlg0011.tlg001.perseus-grc2.tb.xml',
  'tlg0011.tlg002.perseus-grc2.tb.xml',
  'tlg0011.tlg003.perseus-grc1.tb.xml',
  'tlg0011.tlg004.perseus-grc1.tb.xml',
  'tlg0011.tlg005.perseus-grc2.tb.xml',
  'tlg0012.tlg001.perseus-grc1.tb.xml',
  'tlg0012.tlg002.perseus-grc1.tb.xml',
  'tlg0013.tlg002.perseus-grc1.tb.xml',
  'tlg0016.tlg001.perseus-grc1.1.tb.xml',
  'tlg0020.tlg001.perseus-grc1.tb.xml',
  'tlg0020.tlg002.perseus-grc1.tb.xml',
  'tlg0020.tlg003.perseus-grc1.tb.xml',
  'tlg0059.tlg001.perseus-grc1.tb.xml',
  'tlg0060.tlg001.perseus-grc3.11.tb.xml',
  'tlg0085.tlg001.perseus-grc2.tb.xml',
  'tlg0085.tlg002.perseus-grc2.tb.xml',
  'tlg0085.tlg003.perseus-grc2.tb.xml',
  'tlg0085.tlg004.perseus-grc2.tb.xml',
  'tlg0085.tlg005.perseus-grc1.tb.xml',
  'tlg0085.tlg006.perseus-grc2.tb.xml',
  'tlg0085.tlg007.perseus-grc1.tb.xml',
  'tlg0096.tlg002.opp-grc2.1-53.tb.xml',
  'tlg0540.tlg001.perseus-grc1.tb.xml',
  'tlg0540.tlg014.perseus-grc1.tb.xml',
  'tlg0540.tlg015.perseus-grc1.tb.xml',
  'tlg0540.tlg023.perseus-grc1.tb.xml',
  'tlg0543.tlg001.perseus-grc1.tb.xml',
  'tlg0548.tlg001.perseus-grc1.1.1.1-1.4.1.tb.xml',
];

export interface SourceFile {
  /** The path in the sources directory. */
  name: string;
  url: string;
  sha256?: string;
}

export function sourceFiles(): SourceFile[] {
  return [
    ...LSJ_FILES.map((name) => ({
      name: `lsj/${name}`,
      url: `${RAW}/PerseusDL/lexica/${LEXICA_COMMIT}/CTS_XML_TEI/perseus/pdllex/grc/lsj/${name}`,
    })),
    {
      name: MIDDLE_LIDDELL_FILE,
      url: `${RAW}/blinskey/middle-liddell/${MIDDLE_LIDDELL_COMMIT}/Perseus_text_1999.04.0058.xml`,
      sha256: MIDDLE_LIDDELL_SHA256,
    },
    ...TREEBANK_FILES.map((name) => ({
      name: `treebanks/${name}`,
      url: `${RAW}/PerseusDL/treebank_data/${TREEBANK_COMMIT}/v2.1/Greek/texts/${name}`,
    })),
  ];
}

export interface Dictionary {
  id: 'lsj' | 'ml';
  title: string;
  source: string;
  licence: string;
}

/** The dictionaries, in the order the reader shows them, with what the page Sources and licences says of them. */
export const DICTIONARIES: Dictionary[] = [
  {
    id: 'lsj',
    title: 'Liddell, Scott, Jones: A Greek-English Lexicon (1940)',
    source: 'Perseus Digital Library, Tufts University (PerseusDL/lexica).',
    licence: 'CC BY-SA 4.0',
  },
  {
    id: 'ml',
    title: 'Liddell & Scott: An Intermediate Greek-English Lexicon (1889)',
    source: 'Perseus Digital Library, Tufts University.',
    licence: 'CC BY-SA 3.0 US',
  },
];

/** The analyses Morpheus gives the forms of the open Perseus corpus, in the sources directory. */
export const MORPHEUS_FILE = 'morpheus-analyses.tsv.gz';

/** The sources directory of a checkout, when it exists. */
export function defaultSourcesDir(): string | null {
  const dir = path.join(appDir(), 'lexicon-sources');
  return existsSync(dir) ? dir : null;
}

/**
 * The built lexicon `varians lexicon` imports when given nothing else: a
 * file made by `varians lexicon export` and published as a release asset
 * of the repository, pinned by its SHA-256. Null until one is published;
 * docs/lexicon.md says how.
 */
export const PUBLISHED_LEXICON: { url: string; sha256: string } | null = null;
