/** What a merge of registry entries moves and what prevents it (PLAN-2 C8), as the preview shows it. */

export type MergeKind = 'work' | 'witness';

export interface MergeEntryRef {
  id: string;
  slug: string;
  name: string;
}

export interface WitnessMergePreview {
  kind: 'witness';
  from: MergeEntryRef;
  into: MergeEntryRef;
  moves: {
    transcriptions: number;
    readings: number;
    /** Titles of the editions whose conspectus names the merged witness. */
    sigla: string[];
    /** Names of the merged witness's maintainers who do not maintain the survivor yet. */
    maintainers: string[];
    pages: number;
    /** Labels of the hands the survivor does not have. */
    hands: string[];
    /** Identifiers the survivor does not have. */
    identifiers: string[];
  };
  blocks: {
    /** Titles of editions whose conspectus names both witnesses. */
    bothInEdition: string[];
    /** Page labels both witnesses have. */
    pageConflicts: string[];
  };
}

export interface WorkMergePreview {
  kind: 'work';
  from: MergeEntryRef;
  into: MergeEntryRef;
  moves: {
    /** Segments joined to the survivor's segment of the same address. */
    segmentsMatched: number;
    /** Segments the survivor does not have, moved to it. */
    segmentsMoved: number;
    conjectures: number;
    readings: number;
    editions: string[];
    transcriptions: number;
    maintainers: string[];
    identifiers: string[];
  };
  blocks: {
    /** The reference schemes have different levels (keys or types). */
    schemeDiffers: boolean;
    /** Labels a moved segment would share with another segment of the survivor. */
    labelCollisions: string[];
  };
}

export type MergePreview = WitnessMergePreview | WorkMergePreview;

export interface MergeRecord {
  oldId: string;
  label: string;
  mergedAt: string;
}
