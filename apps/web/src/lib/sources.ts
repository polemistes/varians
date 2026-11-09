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

export const USED_SOURCES: UsedSource[] = [
  {
    title: 'A Greek-English Lexicon (Liddell, Scott, Jones, 1940)',
    use: 'Dictionary entries in the reader and in the workbench.',
    source: 'Perseus Digital Library, Tufts University.',
    url: 'https://github.com/PerseusDL/lexica',
    ...CC_BY_SA_4,
  },
  {
    title: 'An Intermediate Greek-English Lexicon (Liddell and Scott, 1889)',
    use: 'Dictionary entries in the reader and in the workbench.',
    source: 'Perseus Digital Library, Tufts University.',
    url: 'https://github.com/PerseusDL/lexica',
    ...CC_BY_SA_3_US,
  },
  {
    title: 'Morphological analyses of Greek word forms (Morpheus)',
    use: 'The lemma and grammar of a word, and the accented forms its letters can have.',
    source: 'Morpheus (perseids-tools/morpheus, Mozilla Public License 2.0), run over the open Greek corpus of the Perseus Digital Library (canonical-greekLit, CC BY-SA 4.0).',
    url: 'https://github.com/perseids-tools/morpheus',
    ...CC_BY_SA_4,
  },
  {
    title: 'Ancient Greek Dependency Treebank',
    use: 'Hand-checked analyses of word forms, preferred to the automatic ones.',
    source: 'Perseus Digital Library, Tufts University.',
    url: 'https://perseusdl.github.io/treebank_data/',
    ...CC_BY_SA_3_US,
  },
  {
    title: 'The Anagnosis lexicon',
    use: 'The forms and dictionaries above, compiled into one database.',
    source: 'Robert Emil Berge, Anagnosis.',
    ...CC_BY_SA_4,
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
