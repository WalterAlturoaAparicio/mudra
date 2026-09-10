/**
 * Reads `config/session.json` and validates it into the typed domain model.
 *
 * The split matters: the *validation rules* live in the domain and are exercised in Node
 * with no network, while this adapter only knows how to get bytes. It also fails at load
 * rather than at first use — an unknown key or an out-of-range threshold is a startup
 * error, not a surprise the first time a pose is held.
 */

import type { ParseOptions, SessionConfig } from '../../domain/config/session-config';
import { ConfigError, parseSessionConfig } from '../../domain/config/session-config';

/** Default location of the session configuration, served as static application content. */
export const SESSION_CONFIG_URL = '/config/session.json';

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

/** Everything the loader needs beyond the domain's own parse options. */
export interface LoadSessionConfigOptions extends ParseOptions {
  /** Where to read the configuration from. Defaults to {@link SESSION_CONFIG_URL}. */
  readonly url?: string;
  /** How to read it. Defaults to a GET-only `fetch`. */
  readonly fetcher?: JsonFetcher;
}

/**
 * Load and validate the session configuration.
 *
 * @throws ConfigError when the file cannot be read, is not JSON, or fails validation.
 */
export async function loadSessionConfig(
  options: LoadSessionConfigOptions = {},
): Promise<SessionConfig> {
  const url = options.url ?? SESSION_CONFIG_URL;
  const fetcher = options.fetcher ?? fetchJson;

  let raw: unknown;
  try {
    raw = await fetcher(url);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError('Could not read session configuration from ' + url + ': ' + detail);
  }

  const parseOptions: ParseOptions =
    options.knownPoseIds === undefined ? {} : { knownPoseIds: options.knownPoseIds };

  try {
    return parseSessionConfig(raw, parseOptions);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw new ConfigError(url + ' is invalid — ' + error.message);
    }
    throw error;
  }
}
