/**
 * A deterministic, store-only ZIP writer (contracts/capture-archive.md, FR-049, research D2).
 *
 * Written rather than installed. The constitution requires a dependency be justified against an
 * existing capability first, and the complete requirement here is four record layouts: a local file
 * header, a stored (uncompressed) payload, a central directory, and an end-of-central-directory
 * record. There is no compression, no encryption, no ZIP64, no streaming and no reading — the four
 * things that make ZIP libraries large.
 *
 * Determinism is *easier* to guarantee in code we own than to coerce from a library that stamps
 * `Date.now()` into every entry. Every framing value below is a fixed constant, so the same content
 * produces byte-identical output on every run and every machine.
 *
 * Correctness is not asserted by reading this file. `scripts/export_web_capture_fixtures.py` opens
 * a generated archive with Python's standard `zipfile`, validates every CRC, and loads every sample
 * through Engine — verification from outside, by an implementation nobody involved wrote.
 */

/** One file to place in the archive. */
export interface ZipEntry {
  /** Forward-slash path inside the archive. No leading slash, no `..`, no drive letter. */
  readonly name: string;
  /** The exact bytes stored. */
  readonly bytes: Uint8Array;
}

/** Raised when an entry name would produce an archive that is unsafe or non-portable. */
export class ZipWriterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipWriterError';
  }
}

/** Compression method 0 — stored. The only method this writer emits. */
const METHOD_STORED = 0;

/**
 * The fixed DOS date/time every entry carries: `1980-01-01T00:00:00`, the DOS epoch.
 *
 * A wall-clock timestamp here would make two exports of identical content differ byte for byte,
 * which is precisely what FR-049 forbids.
 */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

/** Fixed version fields, so the archive does not vary by platform. */
const VERSION_MADE_BY = 20;
const VERSION_NEEDED = 20;

/** General-purpose bit 11: entry names are UTF-8. */
const FLAG_UTF8 = 0x0800;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

/** CRC-32 table for the IEEE polynomial, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

/** CRC-32 of `bytes`, IEEE polynomial `0xEDB88320`. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A growable little-endian byte sink. */
class ByteWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  get offset(): number {
    return this.length;
  }

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  u16(value: number): void {
    const buffer = new Uint8Array(2);
    new DataView(buffer.buffer).setUint16(0, value, true);
    this.push(buffer);
  }

  u32(value: number): void {
    const buffer = new Uint8Array(4);
    new DataView(buffer.buffer).setUint32(0, value >>> 0, true);
    this.push(buffer);
  }

  concat(): Uint8Array {
    const result = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, at);
      at += chunk.length;
    }
    return result;
  }
}

/**
 * Reject a name that would make the archive unsafe or non-portable.
 *
 * An entry named `../../etc/passwd` is the classic archive attack; a backslash or a drive letter is
 * how a Windows-authored archive stops extracting correctly anywhere else.
 */
function checkName(name: string): void {
  if (name.length === 0) {
    throw new ZipWriterError('An archive entry name cannot be empty.');
  }
  if (name.startsWith('/')) {
    throw new ZipWriterError(`Archive entry "${name}" must not start with "/".`);
  }
  if (name.includes('\\')) {
    throw new ZipWriterError(`Archive entry "${name}" must use forward slashes.`);
  }
  if (/^[A-Za-z]:/.test(name)) {
    throw new ZipWriterError(`Archive entry "${name}" must not carry a drive letter.`);
  }
  if (name.split('/').includes('..')) {
    throw new ZipWriterError(`Archive entry "${name}" must not contain a ".." segment.`);
  }
}

/**
 * Build a store-only ZIP archive from `entries`, in the order given.
 *
 * The caller decides order (the archive contract puts `manifest.json` first, then sample entries
 * sorted by name); this function preserves it exactly rather than sorting on its own, so ordering
 * stays one decision in one place.
 *
 * @throws ZipWriterError on an unsafe or non-portable entry name, or a duplicate.
 */
export function buildZipArchive(entries: readonly ZipEntry[]): Uint8Array {
  const seen = new Set<string>();
  for (const entry of entries) {
    checkName(entry.name);
    if (seen.has(entry.name)) {
      throw new ZipWriterError(`Archive entry "${entry.name}" appears more than once.`);
    }
    seen.add(entry.name);
  }

  const encoder = new TextEncoder();
  const body = new ByteWriter();
  const directory = new ByteWriter();

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const checksum = crc32(entry.bytes);
    const size = entry.bytes.length;
    const localOffset = body.offset;

    body.u32(LOCAL_HEADER_SIGNATURE);
    body.u16(VERSION_NEEDED);
    body.u16(FLAG_UTF8);
    body.u16(METHOD_STORED);
    body.u16(DOS_TIME);
    body.u16(DOS_DATE);
    body.u32(checksum);
    body.u32(size); // compressed size — equal, because every entry is stored
    body.u32(size); // uncompressed size
    body.u16(nameBytes.length);
    body.u16(0); // extra field length
    body.push(nameBytes);
    body.push(entry.bytes);

    directory.u32(CENTRAL_HEADER_SIGNATURE);
    directory.u16(VERSION_MADE_BY);
    directory.u16(VERSION_NEEDED);
    directory.u16(FLAG_UTF8);
    directory.u16(METHOD_STORED);
    directory.u16(DOS_TIME);
    directory.u16(DOS_DATE);
    directory.u32(checksum);
    directory.u32(size);
    directory.u32(size);
    directory.u16(nameBytes.length);
    directory.u16(0); // extra field length
    directory.u16(0); // comment length
    directory.u16(0); // disk number start
    directory.u16(0); // internal attributes
    directory.u32(0); // external attributes — fixed, never platform-derived
    directory.u32(localOffset);
    directory.push(nameBytes);
  }

  const centralDirectoryOffset = body.offset;
  const centralDirectory = directory.concat();

  const end = new ByteWriter();
  end.u32(END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  end.u16(0); // this disk number
  end.u16(0); // disk with the central directory
  end.u16(entries.length);
  end.u16(entries.length);
  end.u32(centralDirectory.length);
  end.u32(centralDirectoryOffset);
  end.u16(0); // archive comment length

  const out = new ByteWriter();
  out.push(body.concat());
  out.push(centralDirectory);
  out.push(end.concat());
  return out.concat();
}

/** UTF-8 bytes of `text`, for building entries from JSON. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
