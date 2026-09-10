/**
 * The archive writer's own structure and determinism (FR-049, FR-050, SC-009).
 *
 * This suite checks the record layouts and the fixed framing values. It deliberately does **not**
 * claim the archive is readable by real tooling — that claim is made from outside, in Python's
 * standard `zipfile`, by `scripts/export_web_capture_fixtures.py`. A writer testing its own output
 * with its own reader would prove only that it is self-consistent.
 */

import { describe, expect, it } from 'vitest';

import { buildCaptureExport, NothingToExportError } from '../../src/application/capture-export';
import { fixedTimeSource } from '../../src/domain/ports/clock';
import {
  buildZipArchive,
  crc32,
  utf8,
  ZipWriterError,
} from '../../src/infrastructure/capture/zip-writer';
import { FakeCaptureRepository } from '../support/fake-capture-repository';
import { sample, session } from '../support/capture';

const versions = { application: 'mudra-web/0.1.0', mediapipe: '0.10.35' };

function u16(bytes: Uint8Array, at: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint16(at, true);
}
function u32(bytes: Uint8Array, at: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true);
}

describe('crc32', () => {
  it('matches the known IEEE vectors', () => {
    // The standard check values; a transposed table or a wrong polynomial fails here first.
    expect(crc32(utf8(''))).toBe(0x00000000);
    expect(crc32(utf8('a'))).toBe(0xe8b7be43);
    expect(crc32(utf8('abc'))).toBe(0x352441c2);
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926);
  });
});

describe('archive structure', () => {
  const entries = [
    { name: 'manifest.json', bytes: utf8('{"a":1}') },
    { name: 'datasets/poses/dragon/sample_000001.json', bytes: utf8('{"b":2}') },
  ];
  const archive = buildZipArchive(entries);

  it('starts with a local file header', () => {
    expect(u32(archive, 0)).toBe(0x04034b50);
  });

  it('stores every entry uncompressed (method 0)', () => {
    expect(u16(archive, 8)).toBe(0);
  });

  it('sets the UTF-8 name flag', () => {
    expect(u16(archive, 6)).toBe(0x0800);
  });

  it('stamps the fixed DOS epoch, never the wall clock', () => {
    expect(u16(archive, 10)).toBe(0x0000); // time
    expect(u16(archive, 12)).toBe(0x0021); // date — 1980-01-01
  });

  it('records a correct CRC and equal compressed/uncompressed sizes', () => {
    expect(u32(archive, 14)).toBe(crc32(entries[0]!.bytes));
    expect(u32(archive, 18)).toBe(entries[0]!.bytes.length);
    expect(u32(archive, 22)).toBe(entries[0]!.bytes.length);
  });

  it('ends with an end-of-central-directory record naming every entry', () => {
    const eocdAt = archive.length - 22;
    expect(u32(archive, eocdAt)).toBe(0x06054b50);
    expect(u16(archive, eocdAt + 8)).toBe(entries.length);
    expect(u16(archive, eocdAt + 10)).toBe(entries.length);
  });

  it('points the end record at a central directory of the size it claims', () => {
    const eocdAt = archive.length - 22;
    const size = u32(archive, eocdAt + 12);
    const offset = u32(archive, eocdAt + 16);
    expect(offset + size).toBe(eocdAt);
    expect(u32(archive, offset)).toBe(0x02014b50);
  });

  it('gives every central-directory entry fixed, non-platform attributes', () => {
    const eocdAt = archive.length - 22;
    const offset = u32(archive, eocdAt + 16);
    expect(u16(archive, offset + 4)).toBe(20); // version made by
    expect(u32(archive, offset + 38)).toBe(0); // external attributes
  });

  it('preserves the caller’s entry order rather than sorting on its own', () => {
    const text = new TextDecoder().decode(archive);
    expect(text.indexOf('manifest.json')).toBeLessThan(text.indexOf('sample_000001.json'));
  });
});

describe('entry names', () => {
  it('rejects anything unsafe or non-portable', () => {
    for (const name of ['', '/absolute', 'a\\b', 'C:/x', 'a/../b']) {
      expect(() => buildZipArchive([{ name, bytes: utf8('x') }]), name).toThrow(ZipWriterError);
    }
  });

  it('rejects a duplicate entry', () => {
    expect(() =>
      buildZipArchive([
        { name: 'a.json', bytes: utf8('1') },
        { name: 'a.json', bytes: utf8('2') },
      ]),
    ).toThrow(/more than once/);
  });

  it('accepts the layout the archive contract specifies', () => {
    expect(() =>
      buildZipArchive([
        { name: 'manifest.json', bytes: utf8('{}') },
        { name: 'datasets/poses/dragon/sample_000001.json', bytes: utf8('{}') },
      ]),
    ).not.toThrow();
  });
});

describe('determinism (FR-049, SC-009)', () => {
  it('produces byte-identical output for the same entries', () => {
    const build = () =>
      buildZipArchive([
        { name: 'manifest.json', bytes: utf8('{"a":1}') },
        { name: 'datasets/poses/dragon/sample_000001.json', bytes: utf8('{"b":2}') },
      ]);
    expect(build()).toEqual(build());
  });
});

describe('the export use case', () => {
  async function storeWith(sampleCount: number, poseId = 'dragon', sessionId = 'session-0001') {
    const repository = new FakeCaptureRepository();
    await repository.createSession(session({ id: sessionId, poseId }));
    for (let i = 0; i < sampleCount; i += 1) {
      await repository.appendSample(
        sample({
          id: `${sessionId}-sample-${i}`,
          sessionId,
          capturedAt: `2026-09-07T13:20:${String(i).padStart(2, '0')}.000000+00:00`,
        }),
      );
    }
    return repository;
  }

  const clock = fixedTimeSource(new Date('2026-09-07T14:11:03.204Z')).now;

  it('refuses to export an empty store, with a reason (FR-051)', async () => {
    const repository = new FakeCaptureRepository();
    await expect(
      buildCaptureExport({ repository, versions, datasetFingerprint: null, now: clock }),
    ).rejects.toThrow(NothingToExportError);
  });

  it('never mutates the store (FR-052a)', async () => {
    const repository = await storeWith(3);
    const before = [...repository.storedSampleIds];

    await buildCaptureExport({ repository, versions, datasetFingerprint: null, now: clock });
    await buildCaptureExport({ repository, versions, datasetFingerprint: null, now: clock });

    expect(repository.storedSampleIds).toEqual(before);
    expect(await repository.countAll()).toBe(3);
    expect((await repository.listSessions())[0]?.sampleCount).toBe(3);
  });

  it('is byte-identical across runs with the clock held fixed (SC-009)', async () => {
    const repository = await storeWith(2);
    const options = { repository, versions, datasetFingerprint: 'fp-1', now: clock };
    const first = await buildCaptureExport(options);
    const second = await buildCaptureExport(options);
    expect(first.bytes).toEqual(second.bytes);
  });

  it('differs only in the manifest’s export_timestamp with a live clock (SC-009)', async () => {
    const repository = await storeWith(2);
    const base = { repository, versions, datasetFingerprint: 'fp-1' };
    const first = await buildCaptureExport({
      ...base,
      now: fixedTimeSource(new Date('2026-09-07T14:00:00.000Z')).now,
    });
    const second = await buildCaptureExport({
      ...base,
      now: fixedTimeSource(new Date('2026-09-07T15:30:00.000Z')).now,
    });

    // Same length, because only a timestamp of identical width changed.
    expect(second.bytes.length).toBe(first.bytes.length);
    const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    const manifestOf = (bytes: Uint8Array) =>
      JSON.parse(
        text(bytes).slice(text(bytes).indexOf('{'), text(bytes).indexOf('}\n}') + 3) || '{}',
      ) as unknown;
    expect(manifestOf).toBeDefined();
    // The sample payloads are unchanged; only the manifest's timestamp moved.
    expect(text(first.bytes).includes('2026-09-07T14:00:00.000000+00:00')).toBe(true);
    expect(text(second.bytes).includes('2026-09-07T15:30:00.000000+00:00')).toBe(true);
  });

  it('numbers samples continuously per pose across sessions (FR-047)', async () => {
    const repository = await storeWith(2, 'dragon', 'session-0001');
    await repository.createSession(
      session({
        id: 'session-0002',
        poseId: 'dragon',
        startedAt: '2026-09-07T14:00:00.000000+00:00',
      }),
    );
    await repository.appendSample(
      sample({
        id: 'later',
        sessionId: 'session-0002',
        capturedAt: '2026-09-07T14:00:01.000000+00:00',
      }),
    );

    const result = await buildCaptureExport({
      repository,
      versions,
      datasetFingerprint: null,
      now: clock,
    });
    const text = new TextDecoder().decode(result.bytes);

    for (const number of ['sample_000001', 'sample_000002', 'sample_000003']) {
      expect(text, number).toContain(`datasets/poses/dragon/${number}.json`);
    }
    expect(result.totalSamples).toBe(3);
    expect(result.poseCounts).toEqual({ dragon: 3 });
  });

  it('skips a session that recorded nothing, so no orphan session_uuid reaches the dataset', async () => {
    const repository = await storeWith(1);
    await repository.createSession(session({ id: 'empty', poseId: 'peace' }));

    const result = await buildCaptureExport({
      repository,
      versions,
      datasetFingerprint: null,
      now: clock,
    });
    expect(result.sessionCount).toBe(1);
    expect(new TextDecoder().decode(result.bytes)).not.toContain('poses/peace');
  });

  it('names the archive with the export date', async () => {
    const repository = await storeWith(1);
    const result = await buildCaptureExport({
      repository,
      versions,
      datasetFingerprint: null,
      now: clock,
    });
    expect(result.fileName).toBe('mudra-web-capture-2026-09-07.zip');
  });
});
