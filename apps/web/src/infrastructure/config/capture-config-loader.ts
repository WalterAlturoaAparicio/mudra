/**
 * Reads `config/capture.json` and validates it into the typed domain model.
 *
 * The same split, for the same reason, as `session-config-loader.ts`: the *validation rules* live
 * in the domain and are exercised in Node with no network, while this adapter only knows how to get
 * bytes. `fetch` is used for an inbound GET and nothing else (contracts/privacy.md).
 */

import type { CaptureConfig } from '../../domain/config/capture-config';
import { parseCaptureConfig } from '../../domain/config/capture-config';
import { ConfigError } from '../../domain/config/session-config';

/** Default location of the capture configuration, served as static application content. */
export const CAPTURE_CONFIG_URL = '/config/capture.json';

/** A minimal GET-only fetcher, injected so the loader is testable without a network. */
export type JsonFetcher = (url: string) => Promise<unknown>;

/** Fetch JSON over an inbound GET. No other method is ever used (contracts/privacy.md). */
export const fetchJson: JsonFetcher = async (url: string): Promise<unknown> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new ConfigError(
      'Could not read ' + url + ': HTTP ' + response.status + ' ' + response.statusText + '.',
    );
  }
  return (await response.json()) as unknown;
};

/** Everything the loader needs. */
export interface LoadCaptureConfigOptions {
  /** Where to read the configuration from. Defaults to {@link CAPTURE_CONFIG_URL}. */
  readonly url?: string;
  /** How to read it. Defaults to a GET-only `fetch`. */
  readonly fetcher?: JsonFetcher;
}

/**
 * Load and validate the capture configuration.
 *
 * @throws ConfigError when the file cannot be read, is not JSON, or fails validation.
 */
export async function loadCaptureConfig(
  options: LoadCaptureConfigOptions = {},
): Promise<CaptureConfig> {
  const url = options.url ?? CAPTURE_CONFIG_URL;
  const fetcher = options.fetcher ?? fetchJson;

  let raw: unknown;
  try {
    raw = await fetcher(url);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError('Could not read capture configuration from ' + url + ': ' + detail);
  }

  try {
    return parseCaptureConfig(raw);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw new ConfigError(url + ' is invalid — ' + error.message);
    }
    throw error;
  }
}
