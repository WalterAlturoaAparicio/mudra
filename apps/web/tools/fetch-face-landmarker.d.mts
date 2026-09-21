/**
 * Types for `fetch-face-landmarker.mjs`, so the test suite can import its pure helpers under the
 * strict `tsc --noEmit` without loosening `tsconfig` (no `allowJs`).
 */

/** The one pinned source. */
export const SOURCE_URL: string;
/** The only origin a response may be served from. */
export const ALLOWED_ORIGIN: string;
/** The verified SHA-256, lowercase hex, or `null` while not yet verified. */
export const EXPECTED_SHA256: string | null;
/** Where the model is installed. */
export const DEFAULT_TARGET: string;

/** SHA-256 of a file, lowercase hex. */
export function sha256OfFile(filePath: string): Promise<string>;
/** Whether the file has exactly the expected SHA-256. */
export function verifySha256(filePath: string, expectedHex: string): Promise<boolean>;
/** Decide a downloaded part file's fate; never leaves a bad one behind. */
export function finalize(
  partPath: string,
  targetPath: string,
  expected?: string | null,
): Promise<{ ok: boolean; reason?: 'unpinned' | 'mismatch'; sha256: string }>;
