/**
 * What the pages screen receives from its load and its actions. Plain data;
 * the server builds these from rows and the components only read them.
 */

import type { FacsimileSource } from '$lib/facsimile/types';

export type ImageKind = 'upload' | 'iiif';

/** A page as the screen shows it. */
export interface PageView {
  id: string;
  label: string;
  /** Its place in the list, from 1. */
  index: number;
  imageKind: ImageKind | null;
  width: number | null;
  height: number | null;
  /** A small image for the card, or null without an image. */
  thumbnail: string | null;
  /** What the viewer opens, or null without an image. */
  source: FacsimileSource | null;
  /** The image itself, to read lines from: the uploaded file or the IIIF service. Null without an image. */
  image: { kind: 'file' | 'iiif'; url: string } | null;
  /** Zones drawn on it. */
  zones: number;
  /** Transcripts with text on it. */
  transcriptions: number;
  /** Words on it, in all transcripts. */
  words: number;
  /** The image's rights statement (a listed address), credit line and source; null where not given. */
  rights: string | null;
  attribution: string | null;
  imageSource: string | null;
}

/** What new images of a witness are given unless another statement is chosen. */
export interface ImageDefaults {
  rights: string | null;
  attribution: string | null;
}

/** What GET /api/witnesses/[id]/pages answers: the pages as the screen shows them, and what may be done with them. */
export interface WitnessPagesData {
  witness: {
    id: string;
    slug: string;
    name: string;
    siglum: string;
    iiifManifest: string | null;
    /** A roll: its pages are columns. */
    roll: boolean;
    imageDefaults: ImageDefaults;
  };
  pages: PageView[];
  /** The user maintains the witness and may change its pages. */
  canMaintain: boolean;
  maxUploadBytes: number;
}

export interface ManifestCanvasView {
  label: string;
  thumbnail: string | null;
  width: number | null;
  height: number | null;
}

export interface ManifestPreviewView {
  url: string;
  label: string;
  total: number;
  withImage: number;
  present: number;
  attachable: number;
  canvases: ManifestCanvasView[];
  rights: {
    rights: string | null;
    label: string | null;
    /** The manifest's statement when it is not listed. */
    unlisted: string | null;
    attribution: string | null;
    ownStatements: number;
    fallback: string | null;
    fallbackLabel: string | null;
  };
  warnings: string[];
}

export interface ImportSummaryView {
  label: string;
  canvases: number;
  added: number;
  attached: number;
  skipped: number;
  removed: number;
  kept: number;
  warnings: string[];
}

/** The import modes the dialog offers. */
export type ImportMode = 'new' | 'replace';
