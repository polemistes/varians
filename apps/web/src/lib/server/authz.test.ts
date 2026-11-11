import { describe, expect, it } from 'vitest';
import {
  canCreateRegistryEntry,
  canDeleteEdition,
  canDeleteTranscription,
  canEditConjecture,
  canEditEdition,
  canEditTranscription,
  canGrantOnEdition,
  canMaintainWitness,
  canMaintainWork,
  canPublishEdition,
  canViewEdition,
  canViewTranscription,
  emptyGrants,
  foldGrants,
  isAdministrator,
  isSiteEditor,
  type Actor,
  type Grants,
} from './authz';

const admin: Actor = { id: 'admin', role: 'administrator' };
const editor: Actor = { id: 'editor', role: 'editor' };
const owner: Actor = { id: 'owner', role: 'member' };
const collaborator: Actor = { id: 'collab', role: 'member' };
const stranger: Actor = { id: 'stranger', role: 'member' };
const visitor = null;

const work = { id: 'w1', createdBy: 'owner' };
const witness = { id: 'ms1', createdBy: 'owner' };

const draftTranscription = { id: 't1', ownerId: 'owner', visibility: 'draft' as const };
const publishedTranscription = { id: 't2', ownerId: 'owner', visibility: 'published' as const };

const draftEdition = { id: 'e1', ownerId: 'owner', visibility: 'draft' as const };
const publishedEdition = { id: 'e2', ownerId: 'owner', visibility: 'published' as const };

const conjecture = { id: 'c1', ownerId: 'owner', workId: 'w2' };

/** What the collaborator reaches: edition e1 of work w2, owned by owner, naming transcription t1. */
function collaboratorGrants(): Grants {
  const grants = emptyGrants();
  grants.editions.set('e1', { workId: 'w2', ownerId: 'owner' });
  grants.collaboratingEditionIds.add('e1');
  grants.transcriptionIds.add('t1');
  return grants;
}

describe('site roles', () => {
  it('tells administrators and editors apart from members and visitors', () => {
    expect(isAdministrator(admin)).toBe(true);
    expect(isAdministrator(editor)).toBe(false);
    expect(isSiteEditor(admin)).toBe(true);
    expect(isSiteEditor(editor)).toBe(true);
    expect(isSiteEditor(owner)).toBe(false);
    expect(isSiteEditor(visitor)).toBe(false);
  });

  it('lets anyone signed in add to the registry', () => {
    expect(canCreateRegistryEntry(stranger)).toBe(true);
    expect(canCreateRegistryEntry(visitor)).toBe(false);
  });
});

describe('registry maintainers', () => {
  it('are the creator, the named maintainers and site editors', () => {
    expect(canMaintainWork(owner, work, [])).toBe(true);
    expect(canMaintainWork(collaborator, work, ['collab'])).toBe(true);
    expect(canMaintainWork(collaborator, work, new Set(['collab']))).toBe(true);
    expect(canMaintainWork(editor, work, [])).toBe(true);
    expect(canMaintainWork(admin, work, [])).toBe(true);
    expect(canMaintainWork(stranger, work, [])).toBe(false);
    expect(canMaintainWork(visitor, work, [])).toBe(false);
  });

  it('apply to witnesses alike', () => {
    expect(canMaintainWitness(owner, witness, [])).toBe(true);
    expect(canMaintainWitness(collaborator, witness, ['collab'])).toBe(true);
    expect(canMaintainWitness(editor, witness, [])).toBe(true);
    expect(canMaintainWitness(stranger, witness, [])).toBe(false);
  });
});

describe('transcriptions', () => {
  it('are edited by the owner, by collaborators reached through an edition, and by site editors', () => {
    expect(canEditTranscription(owner, draftTranscription, emptyGrants())).toBe(true);
    expect(canEditTranscription(collaborator, draftTranscription, collaboratorGrants())).toBe(true);
    expect(canEditTranscription(editor, draftTranscription, emptyGrants())).toBe(true);
    expect(canEditTranscription(admin, draftTranscription, emptyGrants())).toBe(true);
    expect(canEditTranscription(collaborator, draftTranscription, emptyGrants())).toBe(false);
    expect(canEditTranscription(stranger, draftTranscription, emptyGrants())).toBe(false);
    expect(canEditTranscription(visitor, draftTranscription, emptyGrants())).toBe(false);
  });

  it('are seen by everyone once published, and otherwise by those who may edit them', () => {
    expect(canViewTranscription(visitor, publishedTranscription, emptyGrants())).toBe(true);
    expect(canViewTranscription(stranger, draftTranscription, emptyGrants())).toBe(false);
    expect(canViewTranscription(collaborator, draftTranscription, collaboratorGrants())).toBe(true);
    expect(canViewTranscription(editor, draftTranscription, emptyGrants())).toBe(true);
  });

  it('are deleted by the owner or an administrator, never by a site editor', () => {
    expect(canDeleteTranscription(owner, draftTranscription)).toBe(true);
    expect(canDeleteTranscription(admin, draftTranscription)).toBe(true);
    expect(canDeleteTranscription(editor, draftTranscription)).toBe(false);
    expect(canDeleteTranscription(collaborator, draftTranscription)).toBe(false);
  });
});

describe('editions', () => {
  it('are edited by the owner, the collaborators and site editors', () => {
    expect(canEditEdition(owner, draftEdition, [])).toBe(true);
    expect(canEditEdition(collaborator, draftEdition, ['collab'])).toBe(true);
    expect(canEditEdition(editor, draftEdition, [])).toBe(true);
    expect(canEditEdition(stranger, draftEdition, ['collab'])).toBe(false);
    expect(canEditEdition(visitor, draftEdition, [])).toBe(false);
  });

  it('are seen by everyone once published', () => {
    expect(canViewEdition(visitor, publishedEdition, [])).toBe(true);
    expect(canViewEdition(stranger, draftEdition, [])).toBe(false);
    expect(canViewEdition(collaborator, draftEdition, ['collab'])).toBe(true);
  });

  it('are published, deleted and granted by the owner or an administrator only', () => {
    for (const can of [canPublishEdition, canDeleteEdition, canGrantOnEdition]) {
      expect(can(owner, draftEdition)).toBe(true);
      expect(can(admin, draftEdition)).toBe(true);
      expect(can(editor, draftEdition)).toBe(false);
      expect(can(collaborator, draftEdition)).toBe(false);
      expect(can(visitor, draftEdition)).toBe(false);
    }
  });
});

describe('conjectures', () => {
  const noContext = { workMaintainerIds: [], grants: emptyGrants() };

  it("are edited by the owner, the collaborators of the owner's editions of the work, the work's maintainers and site editors", () => {
    expect(canEditConjecture(owner, conjecture, noContext)).toBe(true);
    expect(
      canEditConjecture(collaborator, conjecture, {
        workMaintainerIds: [],
        grants: collaboratorGrants(),
      }),
    ).toBe(true);
    expect(
      canEditConjecture(stranger, conjecture, {
        workMaintainerIds: ['stranger'],
        grants: emptyGrants(),
      }),
    ).toBe(true);
    expect(canEditConjecture(editor, conjecture, noContext)).toBe(true);
    expect(canEditConjecture(stranger, conjecture, noContext)).toBe(false);
    expect(canEditConjecture(visitor, conjecture, noContext)).toBe(false);
  });

  it('do not reach a collaborator through an edition of another work or another owner', () => {
    const otherWork = emptyGrants();
    otherWork.editions.set('e9', { workId: 'w1', ownerId: 'owner' });
    expect(
      canEditConjecture(collaborator, conjecture, {
        workMaintainerIds: [],
        grants: otherWork,
      }),
    ).toBe(false);
    const otherOwner = emptyGrants();
    otherOwner.editions.set('e8', { workId: 'w2', ownerId: 'someone-else' });
    expect(
      canEditConjecture(collaborator, conjecture, {
        workMaintainerIds: [],
        grants: otherOwner,
      }),
    ).toBe(false);
  });
});

describe('foldGrants', () => {
  it('turns the rows of the grants query into sets', () => {
    const grants = foldGrants([
      { kind: 'owned', a: 'e1', b: 'w1', c: 'me' },
      { kind: 'collab', a: 'e2', b: 'w2', c: 'other' },
      { kind: 'transcription', a: 't1', b: 'e2', c: null },
      { kind: 'work', a: 'w3', b: null, c: null },
      { kind: 'witness', a: 'ms1', b: null, c: null },
    ]);
    expect([...grants.editions.keys()]).toEqual(['e1', 'e2']);
    expect(grants.editions.get('e2')).toEqual({ workId: 'w2', ownerId: 'other' });
    expect([...grants.collaboratingEditionIds]).toEqual(['e2']);
    expect([...grants.transcriptionIds]).toEqual(['t1']);
    expect([...grants.maintainedWorkIds]).toEqual(['w3']);
    expect([...grants.maintainedWitnessIds]).toEqual(['ms1']);
  });
});
