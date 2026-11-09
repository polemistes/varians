/** The user guide, rendered once from docs/guide.md at the repository root. */
import source from '../../../../../docs/guide.md?raw';
import { render } from './markdown';

export const guide = render(source);
