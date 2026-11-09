/**
 * The data and resources Varians itself uses, with their sources and
 * licences, as the page Sources and licences lists them. Editions and
 * transcriptions name their own sources and licence; these are the ones
 * that come with Varians. Every entry is checked against its source before
 * it is added here.
 */

export interface UsedSource {
  /** What it is. */
  title: string;
  /** What Varians uses it for. */
  use: string;
  /** Who made it, and where it comes from. */
  source: string;
  url?: string;
  licence: string;
  licenceUrl?: string;
}

export const OFL = { licence: 'SIL Open Font Licence 1.1', licenceUrl: 'https://openfontlicense.org' };

const CC_BY_SA_4 = { licence: 'CC BY-SA 4.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' };
const CC_BY_SA_3_US = { licence: 'CC BY-SA 3.0 US', licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0/us/' };

const REPOSITORY = 'https://github.com/polemistes/varians';

/** The licences of Varians itself: the code, its domain package, and the specification of its formats. */
export const VARIANS_LICENCES: UsedSource[] = [
  {
    title: 'The application',
    use: 'The site, its editors, its server and its database schema (apps/web, packages/db).',
    source: 'The authors of Varians.',
    url: REPOSITORY,
    licence: 'GNU Affero General Public License, version 3 or later',
    licenceUrl: 'https://www.gnu.org/licenses/agpl-3.0.html',
  },
  {
    title: 'The domain package',
    use: 'Token streams, normalization, collation, the apparatus, TEI and the history, usable without the application (packages/core).',
    source: 'The authors of Varians.',
    url: `${REPOSITORY}/tree/main/packages/core`,
    licence: 'Apache License 2.0',
    licenceUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
  },
  {
    title: 'The Varians data format',
    use: 'The specification of the archive and of the TEI subset (docs/formats).',
    source: 'The authors of Varians.',
    url: `${REPOSITORY}/tree/main/docs/formats`,
    licence: 'CC BY 4.0 for the text; BSD 2-Clause for the schemas',
    licenceUrl: `${REPOSITORY}/blob/main/docs/formats/LICENSE`,
  },
];

export const USED_SOURCES: UsedSource[] = [
  {
    title: 'A Greek-English Lexicon (Liddell, Scott, Jones, 1940)',
    use: 'Dictionary entries in the reader and in the workbench, built from the TEI by varians lexicon.',
    source: 'Perseus Digital Library, Tufts University (PerseusDL/lexica).',
    url: 'https://github.com/PerseusDL/lexica',
    ...CC_BY_SA_4,
  },
  {
    title: 'An Intermediate Greek-English Lexicon (Liddell and Scott, 1889)',
    use: 'Dictionary entries in the reader and in the workbench, built from the TEI by varians lexicon.',
    source: 'Perseus Digital Library, Tufts University; its XML as mirrored, with a few typographical corrections, at blinskey/middle-liddell.',
    url: 'https://github.com/blinskey/middle-liddell',
    ...CC_BY_SA_3_US,
  },
  {
    title: 'Morphological analyses of Greek word forms (Morpheus)',
    use: 'The lemma and grammar of a word, and the accented forms its letters can have.',
    source:
      'Morpheus (perseids-tools/morpheus, Mozilla Public License 2.0), run by the Anagnosis pipeline of Robert Emil Berge over the open Greek corpus of the Perseus Digital Library (canonical-greekLit, CC BY-SA 4.0) and the treebank; the file lexicon/morpheus-analyses.tsv.gz of the release.',
    url: 'https://github.com/perseids-tools/morpheus',
    ...CC_BY_SA_4,
  },
  {
    title: 'Ancient Greek Dependency Treebank',
    use: 'Hand-checked analyses of word forms, preferred to the automatic ones.',
    source: 'Perseus Digital Library, Tufts University (PerseusDL/treebank_data, version 2.1).',
    url: 'https://github.com/PerseusDL/treebank_data',
    ...CC_BY_SA_3_US,
  },
  {
    title: 'EB Garamond',
    use: 'The typeface of texts, with polytonic Greek.',
    source: 'Georg Duffner and Octavio Pardo.',
    url: 'https://github.com/octaviopardo/EBGaramond12',
    ...OFL,
  },
  {
    title: 'Cardo',
    use: 'The alternative typeface of texts, with polytonic Greek and other scripts.',
    source: 'David J. Perry.',
    url: 'https://scholarsfonts.net/cardofnt.html',
    ...OFL,
  },
];
