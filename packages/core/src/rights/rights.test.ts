import { describe, expect, it } from 'vitest';
import {
  IMAGE_RIGHTS,
  isCopyable,
  licenceCompatible,
  licenceInfo,
  normalizeRights,
} from './rights.ts';

describe('licences and rights', () => {
  it('knows the data licences by SPDX id', () => {
    expect(licenceInfo('CC-BY-SA-4.0')).toEqual({
      id: 'CC-BY-SA-4.0',
      name: 'CC BY-SA 4.0',
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    });
    expect(licenceInfo('GPL-3.0')).toBeNull();
  });

  it('lets CC0 go anywhere, CC BY into CC BY and CC BY-SA, CC BY-SA into CC BY-SA only', () => {
    expect(licenceCompatible('CC0-1.0', 'CC-BY-4.0')).toBe(true);
    expect(licenceCompatible('CC-BY-4.0', 'CC-BY-SA-4.0')).toBe(true);
    expect(licenceCompatible('CC-BY-4.0', 'CC0-1.0')).toBe(false);
    expect(licenceCompatible('CC-BY-SA-4.0', 'CC-BY-4.0')).toBe(false);
    expect(licenceCompatible('CC-BY-SA-4.0', 'CC-BY-SA-4.0')).toBe(true);
  });

  it('lists sixteen statements and copies only the open and no-copyright ones', () => {
    expect(IMAGE_RIGHTS).toHaveLength(16);
    expect(isCopyable('https://creativecommons.org/licenses/by-nc-nd/4.0/')).toBe(true);
    expect(isCopyable('http://rightsstatements.org/vocab/NoC-OKLR/1.0/')).toBe(true);
    expect(isCopyable('http://rightsstatements.org/vocab/InC/1.0/')).toBe(false);
    expect(isCopyable('http://rightsstatements.org/vocab/NKC/1.0/')).toBe(false);
    expect(isCopyable(null)).toBe(false);
  });

  it('reads statements as sources give them', () => {
    expect(normalizeRights('http://creativecommons.org/licenses/by/4.0')).toBe(
      'https://creativecommons.org/licenses/by/4.0/',
    );
    expect(normalizeRights('https://creativecommons.org/licenses/by-sa/4.0/legalcode')).toBe(
      'https://creativecommons.org/licenses/by-sa/4.0/',
    );
    expect(normalizeRights('https://rightsstatements.org/vocab/InC/1.0/')).toBe(
      'http://rightsstatements.org/vocab/InC/1.0/',
    );
    expect(normalizeRights('https://creativecommons.org/licenses/by/3.0/')).toBeNull();
  });
});
