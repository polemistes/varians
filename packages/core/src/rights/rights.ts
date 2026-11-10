/**
 * Licences of records and rights of images (Varians Data Format 2, section
 * 10): the data licences an installation may choose, the rights statements
 * an image may carry, which of them allow an image to be copied, and which
 * licences may go into an installation under which.
 */

/** The data licences of an installation, as SPDX identifiers. */
export const DATA_LICENCES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0'] as const;
export type DataLicence = (typeof DATA_LICENCES)[number];

export interface LicenceInfo {
  id: DataLicence;
  /** The short name, as cited. */
  name: string;
  url: string;
}

const LICENCES: Record<DataLicence, LicenceInfo> = {
  'CC0-1.0': {
    id: 'CC0-1.0',
    name: 'CC0 1.0',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  'CC-BY-4.0': {
    id: 'CC-BY-4.0',
    name: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
  },
  'CC-BY-SA-4.0': {
    id: 'CC-BY-SA-4.0',
    name: 'CC BY-SA 4.0',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
};

/** The licence of registry records: works, witnesses, segments, bibliography. */
export const REGISTRY_LICENCE: DataLicence = 'CC0-1.0';

export function isDataLicence(value: unknown): value is DataLicence {
  return typeof value === 'string' && (DATA_LICENCES as readonly string[]).includes(value);
}

export function licenceInfo(id: string | null | undefined): LicenceInfo | null {
  return isDataLicence(id) ? LICENCES[id] : null;
}

/**
 * Whether records under `incoming` may go into an installation whose data
 * licence is `target` (10.2): CC0 anywhere; CC BY into CC BY and CC BY-SA;
 * CC BY-SA into CC BY-SA only.
 */
export function licenceCompatible(incoming: DataLicence, target: DataLicence): boolean {
  if (incoming === 'CC0-1.0') return true;
  if (incoming === 'CC-BY-4.0') return target === 'CC-BY-4.0' || target === 'CC-BY-SA-4.0';
  return target === 'CC-BY-SA-4.0';
}

export interface RightsStatement {
  uri: string;
  /** A short label for a list. */
  label: string;
  /** Whether an image under this statement may be copied into archives and packages. */
  copyable: boolean;
}

const RS = (code: string, label: string, copyable: boolean): RightsStatement => ({
  uri: `http://rightsstatements.org/vocab/${code}/1.0/`,
  label,
  copyable,
});
const CC = (code: string, label: string): RightsStatement => ({
  uri: `https://creativecommons.org/licenses/${code}/4.0/`,
  label,
  copyable: true,
});

/** The rights statements an image may carry, in the order a list offers them. */
export const IMAGE_RIGHTS: readonly RightsStatement[] = [
  {
    uri: 'https://creativecommons.org/publicdomain/mark/1.0/',
    label: 'Public Domain Mark',
    copyable: true,
  },
  { uri: 'https://creativecommons.org/publicdomain/zero/1.0/', label: 'CC0 1.0', copyable: true },
  CC('by', 'CC BY 4.0'),
  CC('by-sa', 'CC BY-SA 4.0'),
  CC('by-nd', 'CC BY-ND 4.0'),
  CC('by-nc', 'CC BY-NC 4.0'),
  CC('by-nc-sa', 'CC BY-NC-SA 4.0'),
  CC('by-nc-nd', 'CC BY-NC-ND 4.0'),
  RS('NoC-NC', 'No Copyright, Non-Commercial Use Only', true),
  RS('NoC-OKLR', 'No Copyright, Other Known Legal Restrictions', true),
  RS('InC', 'In Copyright', false),
  RS('InC-EDU', 'In Copyright, Educational Use Permitted', false),
  RS('InC-NC', 'In Copyright, Non-Commercial Use Permitted', false),
  RS('CNE', 'Copyright Not Evaluated', false),
  RS('UND', 'Copyright Undetermined', false),
  RS('NKC', 'No Known Copyright', false),
];

/**
 * A rights statement from what a source gives: the address as listed, with
 * or without its scheme's s, trailing slash, or a `deed`/`legalcode` ending;
 * Creative Commons addresses of other versions are not listed and give null.
 */
export function normalizeRights(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value
    .trim()
    .replace(/^http:\/\/creativecommons\.org/u, 'https://creativecommons.org')
    .replace(/^https:\/\/rightsstatements\.org/u, 'http://rightsstatements.org')
    .replace(/(deed(\.[a-z-]+)?|legalcode(\.[a-z-]+)?)$/iu, '')
    .replace(/\/?$/u, '/');
  return IMAGE_RIGHTS.find((r) => r.uri.toLowerCase() === v.toLowerCase())?.uri ?? null;
}

export function rightsStatement(uri: string | null | undefined): RightsStatement | null {
  return uri ? (IMAGE_RIGHTS.find((r) => r.uri === uri) ?? null) : null;
}

/** Whether an image under this statement may be copied into an archive or package: never when it has none. */
export function isCopyable(uri: string | null | undefined): boolean {
  return rightsStatement(uri)?.copyable ?? false;
}
