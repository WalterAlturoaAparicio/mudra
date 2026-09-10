/**
 * Principle II, made enforceable (contracts/privacy.md, research D14).
 *
 * A camera application is exactly where a "save your clip" button appears later by
 * accident. A prose prohibition does not survive a future contributor; a failing build
 * does. The test names the specific APIs because naming them is what makes it enforceable
 * rather than aspirational.
 *
 * The scan reads comment- and string-stripped source, so the several files that
 * deliberately *mention* these APIs — to explain why they are forbidden — are not mistaken
 * for files that call them.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_ROOT, SRC_ROOT, findMatches, readSources } from '../support/source-scan';

const sources = readSources(SRC_ROOT);

/**
 * Anything that would write camera-derived data to a device (FR-005, FR-008).
 *
 * `indexedDB` is deliberately **not** here (constitution v1.7.0, contracts/privacy-persistence.md):
 * local project persistence is Milestone 2's own feature, scoped to exactly one directory
 * below (`infrastructure/persistence/**`) and asserted nowhere else. Every other storage API
 * remains fully prohibited everywhere, including inside that same directory.
 */
const STORAGE_APIS = [
  'localStorage',
  'sessionStorage',
  'openDatabase',
  'caches',
  'navigator.storage',
  'showSaveFilePicker',
  'FileSystemWritableFileStream',
];

const PERSISTENCE_DIR = join(SRC_ROOT, 'infrastructure/persistence');
/** `SourceFile.path` is relative to `apps/web/`, forward-slash-joined — a separate constant
 *  in that same shape, since `PERSISTENCE_DIR` above is absolute (needed for `readSources`). */
const PERSISTENCE_DIR_RELATIVE = 'src/infrastructure/persistence/';

/**
 * Anything by which imagery escapes a canvas (FR-005, FR-006).
 *
 * `getImageData` and `createImageBitmap` are here even though they are canvas APIs rather
 * than storage ones: the prohibition is about imagery leaving memory, not about which API
 * carries it. If a future milestone genuinely needs one, the exemption belongs in that
 * milestone's authorization, added deliberately — not quietly to this list.
 */
const READBACK_APIS = [
  'toDataURL',
  'toBlob',
  'captureStream',
  'MediaRecorder',
  'getImageData',
  'createImageBitmap',
];

/** Anything that would send data off the device (FR-006). */
const UPLOAD_APIS = ['XMLHttpRequest', 'sendBeacon', 'WebSocket', 'RTCPeerConnection'];

function scan(names: readonly string[]): string[] {
  const offenders: string[] = [];
  for (const file of sources) {
    for (const name of names) {
      offenders.push(...findMatches(file, new RegExp(`\\b${name}\\b`)));
    }
  }
  return offenders;
}

describe('nothing is persisted (FR-005, FR-008, SC-010)', () => {
  it('references no storage API', () => {
    expect(scan(STORAGE_APIS)).toEqual([]);
  });

  it('has source to scan', () => {
    // Without this, an empty src/ would make every assertion above vacuously true.
    expect(sources.length).toBeGreaterThan(10);
  });
});

describe('local project persistence is scoped to one directory (constitution v1.7.0, contracts/privacy-persistence.md)', () => {
  it('uses indexedDB only inside infrastructure/persistence/**', () => {
    const offenders: string[] = [];
    for (const file of sources) {
      if (file.path.startsWith(PERSISTENCE_DIR_RELATIVE)) {
        continue;
      }
      offenders.push(...findMatches(file, /\bindexedDB\b/));
    }
    expect(offenders, 'no other module may touch IndexedDB directly').toEqual([]);
  });

  it('never persists a camera frame, image, or video (FR-031)', () => {
    // The stronger, name-agnostic guarantee: nothing in the persistence directory reaches
    // for a camera/segmentation source type when building what it stores.
    const offenders: string[] = [];
    for (const file of readSources(PERSISTENCE_DIR)) {
      offenders.push(...findMatches(file, /MirroredSurface|LandmarkFrame|SegmentationFrame\.mask/));
    }
    expect(offenders, 'persistence must not import camera- or segmentation-shaped data').toEqual(
      [],
    );
  });
});

describe('no imagery leaves memory (FR-005, FR-006)', () => {
  it('reads back no canvas pixels and records no stream', () => {
    expect(scan(READBACK_APIS)).toEqual([]);
  });
});

describe('nothing is transmitted (FR-006)', () => {
  it('opens no socket and posts no beacon', () => {
    expect(scan(UPLOAD_APIS)).toEqual([]);
  });

  it('uses fetch only for inbound GETs', () => {
    // A `fetch` with a method, body, or non-GET init is an upload path whatever it is
    // called. Inbound GETs — the model, the bundle, configuration, assets — are permitted.
    const offenders: string[] = [];
    for (const file of sources) {
      offenders.push(...findMatches(file, /fetch\s*\([^)]*,\s*\{/));
      offenders.push(...findMatches(file, /method\s*:\s*'(POST|PUT|PATCH|DELETE)'/i));
    }
    expect(offenders).toEqual([]);
  });
});

describe('no recording, capture, download or share affordance exists for the CAMERA VIEW (FR-007)', () => {
  /**
   * `presentation/editor/project-panel.ts` is the one deliberate, spec-authorized exception
   * (constitution v1.7.0, FR-028): exporting a **project** — effect data, never camera
   * imagery — as a downloadable file. FR-007's prohibition is specifically about the camera
   * view and its effects output (FR-057 restates this precisely: "no new mechanism for
   * recording, capturing, screenshotting, or sharing the camera view or its effects
   * output"), so this one file is scoped out; every other file remains fully checked.
   */
  const PROJECT_PANEL_PATH = 'src/presentation/editor/project-panel.ts';
  /**
   * Capture Mode's dataset export — the second and last download exemption (constitution
   * v1.8.0, contracts/privacy-capture.md). Exporting a **landmark dataset** is a download by
   * definition, and it is still never camera imagery.
   */
  const CAPTURE_EXPORT_PATH = 'src/presentation/capture/capture-export-panel.ts';
  const DOWNLOAD_EXEMPTIONS = [PROJECT_PANEL_PATH, CAPTURE_EXPORT_PATH];
  /**
   * Capture Mode's session controls are correctly labelled "Capture" — they record landmark
   * samples, which is the feature. The label exemption is that tree and the project panel,
   * and nothing else.
   */
  const LABEL_EXEMPTIONS = [PROJECT_PANEL_PATH, 'src/presentation/capture/'];

  const isExempt = (path: string, exemptions: readonly string[]): boolean =>
    exemptions.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));

  const downloadSources = readSources(SRC_ROOT).filter(
    (f) => !isExempt(f.path, DOWNLOAD_EXEMPTIONS),
  );
  const markupSources = readSources(SRC_ROOT).filter((f) => !isExempt(f.path, LABEL_EXEMPTIONS));
  const markup = markupSources.map((f) => f.raw);

  it('creates no download link outside project export and dataset export', () => {
    // `<a download>` is the shortest path from "look at this" to "keep this", in markup or
    // in code that builds an anchor.
    const offenders = downloadSources
      .map((f) => f.raw)
      .filter((source) => /download\s*=/.test(source) || /\.download\b/.test(source));
    expect(offenders).toEqual([]);
  });

  it('keeps both exemption lists exactly as short as they are', () => {
    // Adding a third entry is then a deliberate edit to a test that fails first — which is
    // the point of naming the exemptions rather than relaxing a pattern.
    expect(DOWNLOAD_EXEMPTIONS).toHaveLength(2);
    expect(LABEL_EXEMPTIONS).toHaveLength(2);
  });

  it('labels no control record / capture / save / download / share, outside the two exemptions', () => {
    // An API-and-label check by design, **not** a UI crawler. The API scan above cannot
    // catch an affordance wired to a permitted path, and a crawler would be
    // disproportionate to the risk.
    const forbidden = /\b(record|recording|capture|screenshot|save|download|share)\b/i;
    const offenders: string[] = [];
    for (const source of markup) {
      // Only text that reaches a user: element text content and accessible labels.
      const labels = [
        ...source.matchAll(
          /(?:textContent|innerText|ariaLabel|placeholder|title)\s*=\s*'([^']*)'/g,
        ),
        ...source.matchAll(/aria-label\s*=\s*"([^"]*)"/g),
      ].map((match) => match[1]!);
      offenders.push(...labels.filter((label) => forbidden.test(label)));
    }
    expect(offenders, 'no user-facing capture affordance may exist').toEqual([]);
  });

  it('has no such control in index.html either', () => {
    const html = readFileSync(join(APP_ROOT, 'index.html'), 'utf-8');
    expect(/\bdownload\b/i.test(html)).toBe(false);
    expect(/<a\s[^>]*href\s*=\s*"(blob|data):/i.test(html)).toBe(false);
  });
});

/**
 * The exemptions above are narrow, and narrowness is asserted rather than assumed
 * (contracts/privacy-capture.md, "Compensating assertions").
 */
describe('the capture tree is narrow where it is exempt', () => {
  const captureSources = readSources(SRC_ROOT).filter(
    (file) => file.path.includes('/capture/') || file.path === 'src/capture-main.ts',
  );

  it('has capture source to scan', () => {
    expect(captureSources.length).toBeGreaterThan(5);
  });

  it('calls no readback or upload API of its own', () => {
    // Already covered by the global scan; stated locally so a future exemption cannot
    // quietly come to cover the capture tree as well.
    const offenders: string[] = [];
    for (const file of captureSources) {
      for (const name of [...READBACK_APIS, ...UPLOAD_APIS]) {
        offenders.push(...findMatches(file, new RegExp(`\\b${name}\\b`)));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('names no camera or segmentation type in what it stores and exports', () => {
    // The capture *controller* legitimately receives a MirroredSurface and a LandmarkFrame,
    // and the panels draw them; the modules that build the stored and exported bytes must
    // not know those types exist.
    const offenders: string[] = [];
    for (const file of captureSources) {
      if (
        file.path === 'src/application/capture-controller.ts' ||
        file.path.startsWith('src/presentation/capture/')
      ) {
        continue;
      }
      offenders.push(...findMatches(file, /MirroredSurface|SegmentationFrame|ImageBitmap/));
    }
    expect(offenders, 'stored and exported data is landmarks, never imagery').toEqual([]);
  });
});
