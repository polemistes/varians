/**
 * What may be done with a page of a witness, from the menu of its card
 * (docs/design.md, section 4): the one menu of the shared component, with
 * the items that belong to a page in their groups: View and Rename; where it
 * stands; its image; and last, after a separator, its removal. An item that
 * cannot be done now is shown disabled with its reason.
 */
import { joinGroups, type MenuEntry, type RecordActions } from '$lib/record/actions';
import { pageStrings } from '$lib/strings/pages';

const t = pageStrings.menu;

/** The ids of the menu's items, which the card or its grid does. */
export type PageActionId =
  | 'view'
  | 'rename'
  | 'moveUp'
  | 'moveDown'
  | 'moveTo'
  | 'image'
  | 'moveImage'
  | 'rights'
  | 'removeImage'
  | 'shiftImages'
  | 'remove';

/** What decides the items: where the page stands and what it has. */
export interface PageMenuState {
  /** Its position, from 1. */
  index: number;
  /** How many pages the witness has. */
  count: number;
  hasImage: boolean;
  /** The parent can show its image on its own, so View is offered. */
  canView: boolean;
  /** Something is happening to the page already. */
  busy: boolean;
}

/** The menu of a page card, for those who may change the page; nobody else has one. */
export function pageActions(state: PageMenuState): RecordActions {
  const { index, count, hasImage, canView, busy } = state;
  const action = (
    id: PageActionId,
    label: string,
    reason?: string | false | null,
    danger = false,
  ): MenuEntry => ({
    kind: 'action',
    id,
    label,
    ...(danger ? { danger: true } : {}),
    ...(reason ? { disabled: reason } : {}),
  });
  const working = busy ? t.busy : null;

  const settings: MenuEntry[] = [
    ...(canView ? [action('view', t.view)] : []),
    action('rename', t.rename, working),
  ];
  const placing: MenuEntry[] = [
    action('moveUp', t.moveUp, working ?? (index <= 1 ? t.first : null)),
    action('moveDown', t.moveDown, working ?? (index >= count ? t.last : null)),
    action('moveTo', t.moveTo, working ?? (count < 2 ? t.onlyPage : null)),
  ];
  const imaging: MenuEntry[] = [
    action('image', hasImage ? t.replaceImage : t.addImage, working),
    ...(hasImage
      ? [
          action('moveImage', t.moveImage, working ?? (count < 2 ? t.onlyPage : null)),
          action('rights', t.rights, working),
          action('removeImage', t.removeImage, working),
        ]
      : []),
    action('shiftImages', t.shiftImages, working),
  ];
  const removing: MenuEntry[] = [action('remove', t.remove, working, true)];

  return { buttons: [], menu: joinGroups([settings, placing, imaging, removing]) };
}
