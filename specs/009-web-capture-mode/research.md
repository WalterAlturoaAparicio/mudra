# Research: Mudra Web — Gated Web Capture Mode

**Feature**: `009-web-capture-mode` | **Date**: 2026-09-07

Phase 0 decisions. Each is a choice the specification deliberately left open, resolved against the
existing code rather than against a preference. Where an alternative was rejected, the reason is
recorded so a later reader can tell a decision from an accident.

---

## D1 — Capture is a third page, gated at the bundler's input list

**Decision**: `capture.html` + `src/capture-main.ts`, added to the build's input list **only** when
`VITE_MUDRA_CAPTURE=1`. Nothing else imports anything under `src/**/capture/**`.

**Rationale**: `vite.config.ts` already builds two explicit inputs (`index.html`, `editor.html`).
Capture is a third of exactly the same kind. Because module graphs are rooted at inputs, omitting the
input omits the entire capture subgraph — no dead code, no tree-shaking assumption, no runtime branch
to get wrong. This is what makes FR-001 and SC-011 assertable by inspecting the build config and the
emitted output rather than by trusting a flag check at runtime.

**Alternatives considered**:

- *A route or mode inside `editor.html`.* Rejected: the capture code would ship in the public bundle
  and be gated by a runtime conditional — exactly the "present but disabled" shape `future-work.md`
  says must not exist, and unverifiable against SC-011.
- *A separate repository or deployment.* Rejected: duplicates the camera, detector, normalization and
  build tooling, which is the drift the monorepo rules exist to prevent.

---

## D2 — A store-only ZIP writer inside the application, no dependency

**Decision**: implement a ~120-line deterministic ZIP writer in
`src/infrastructure/capture/zip-writer.ts` using compression method 0 (stored) and a hand-written
CRC-32. No package is added.

**Rationale**: the application has exactly one runtime dependency today, and the constitution requires
a dependency be justified against an existing capability first. The complete requirement here is:
concatenate local file headers, stored (uncompressed) payloads, a central directory, and an
end-of-central-directory record. There is no compression, no encryption, no ZIP64, no streaming, and
no reading — the four things that make ZIP libraries large. Determinism (FR-049) is *easier* to
guarantee in code we own than to coerce from a library that stamps `Date.now()` into every entry.
Correctness is not asserted by inspection: FR-050 requires every generated archive be opened and
CRC-validated by Python's standard `zipfile` in the repository's own tooling, which is a stronger
check than a dependency's own test suite would give us.

**Determinism rules** (all testable, all from FR-049):

| Property | Rule |
|---|---|
| Entry order | `manifest.json` first, then sample entries sorted lexicographically by full entry name |
| Entry names | forward slashes, no leading slash, no `..`, no drive letter, UTF-8 bytes, general-purpose bit 11 set |
| Method | 0 (stored) for every entry |
| Timestamps | fixed constant `1980-01-01T00:00:00` (the DOS epoch, MS-DOS date `0x0021`, time `0x0000`) for every entry — never the wall clock |
| External attributes / version fields | fixed constants, never platform-derived |
| CRC-32 | computed per entry over the exact stored bytes |
| Result | same store content ⇒ byte-identical archive (SC-009) |

**Alternatives considered**:

- *Add `fflate` or `jszip`.* Rejected: a dependency for a problem whose whole surface is four record
  layouts, and both stamp current time by default, so determinism would need overriding anyway.
- *No archive — one JSON file per download.* Rejected: a hundred-sample session means a hundred
  browser downloads.
- *One JSON file containing many samples.* Rejected outright: that is a second, Web-specific format,
  which is precisely what FR-029 forbids.

---

## D3 — Timestamps are written in Engine's format, not JavaScript's default

**Decision**: every timestamp Web writes uses `YYYY-MM-DDTHH:MM:SS.ffffff+00:00` — six fractional
digits, explicit `+00:00` offset. JavaScript's `toISOString()` (`…​.mmmZ`) is **not** used directly;
milliseconds are right-padded with `000` and `Z` is replaced by `+00:00`.

**Rationale**: every sample already in `datasets/poses/` carries Python's `datetime.isoformat()`
output, which is exactly this shape. Engine's serializer treats the field as an opaque string, so a
`Z`-suffixed millisecond timestamp would load fine — and would then sit in the same pose collection
looking different from its siblings, for no reason. FR-030's "truthful value" is satisfied either
way; matching the dataset's existing convention costs one small formatting function and keeps the
merged dataset uniform for any tool that sorts, parses, or diffs it.

**Alternatives considered**:

- *Emit `toISOString()` verbatim.* Rejected for the inconsistency above.
- *Emit real microsecond precision.* Impossible: browser wall-clock time is millisecond-resolution.
  Padding with `000` is honest — it says "we know this to the millisecond" — where inventing three
  digits of noise would not be.

---

## D4 — `camera.index` is `0` by stated convention; `position` and `lens_facing` are absent

**Decision**: write `metadata.camera.index: 0`, and write neither `position` nor `lens_facing`.
`width`/`height` come from `MirroredSurface.width`/`.height`, which are real device pixels.

**Rationale**: `index` is required by Engine's schema (`camera["index"]`, looked up unconditionally),
so it must carry something; browsers expose no stable, meaningful camera index, so `0` is documented
to mean "the default camera this session opened" and nothing more. `position` and `lens_facing` are
*optional* additive fields Capture writes because a phone genuinely knows its lens. A browser does
not: `facingMode` is a request, not a guarantee, and on a laptop the concept does not apply. FR-032
therefore omits them — an absent optional field is correct where an invented value would be false,
and this is the exact discipline the feature request asked for.

---

## D5 — Versions reach the browser the same way the dataset fingerprint already does

**Decision**: two new Vite `define` constants, `__APP_VERSION__` (from `apps/web/package.json`) and
`__MEDIAPIPE_VERSION__` (from the installed `@mediapipe/tasks-vision` package), mirroring the existing
`__DATASET_FINGERPRINT__`. `versions.application` is written as `mudra-web/<version>`;
`versions.mediapipe` as the tasks-vision version string.

**Rationale**: `vite.config.ts` already establishes this pattern for exactly this kind of
build-time-known, runtime-needed value. `versions.application` is an existing Engine-owned field, so
naming the producing application there gives every Web sample its provenance with **zero** additive
fields (FR-034) — which is why no `source` field is introduced.

---

## D6 — A separate database inside the one directory already permitted to touch storage

**Decision**: IndexedDB, database `mudra-capture` (version 1), object stores `sessions` (keyPath
`id`) and `samples` (keyPath `id`, index `by_session` on `sessionId`). Implemented in
`src/infrastructure/persistence/indexeddb-capture-repository.ts`, behind
`src/domain/ports/capture-repository.ts`.

**Rationale**: the privacy scan permits `indexedDB` in exactly one directory. Placing the capture
store in that same directory means the permitted-directory list does **not** grow (FR-039) — the
narrowest possible change. A separate *database* rather than a separate store in `mudra-editor` is
what makes FR-037 structural: clearing capture data cannot touch projects, and a bug in one repository
cannot address the other's records because they are not in the same connection.

Two stores rather than one embedded array: a session's samples must be individually deletable
(FR-042) and a hundred-sample session should not be rewritten to delete one of them.

**Why camera data cannot leak in** (FR-040): the persisted record's type is built from
`CaptureSample`, whose fields are numbers, strings and landmark arrays. There is no field of type
`unknown`, `Blob`, `ImageBitmap`, or `MirroredSurface` anywhere in the graph, so "accidentally
persisting a frame" is not a mistake one can make — it is a type error. The existing privacy test's
persistence-directory scan (`MirroredSurface | LandmarkFrame | SegmentationFrame.mask`) continues to
pass **unmodified**, because the conversion from a `LandmarkFrame` happens in the application layer
and the persistence layer only ever sees `CaptureSample`.

**Alternatives considered**:

- *A new store inside the `mudra-editor` database.* Rejected: one upgrade transaction and one
  connection shared between projects and capture data is the coupling FR-037 exists to prevent.
- *A new directory, e.g. `infrastructure/capture-persistence/`.* Rejected: it would require widening
  the privacy scan's permitted-directory list, which is a real loosening for a cosmetic gain.

---

## D7 — Two named exemptions, and no refactor of Milestone 2 code

**Decision**: extend the existing FR-007 affordance scan with exactly two scoped exemptions:

| Check | Existing exemption | Added |
|---|---|---|
| `<a download>` / `.download` | `src/presentation/editor/project-panel.ts` | `src/presentation/capture/capture-export-panel.ts` |
| user-facing capture/record/save/download labels | `src/presentation/editor/project-panel.ts` | `src/presentation/capture/**` |

Everything else — readback APIs, upload APIs, non-GET `fetch`, the other storage APIs, and the label
scan across every non-capture file — stays exactly as it is.

**Rationale**: the exemption is expressed as a short list of named paths, the same mechanism already
used for project export, so it is reviewable at a glance and cannot silently widen. Two compensating
assertions are added rather than relying on the exemption being narrow: the capture tree is asserted
to contain **no** readback or upload API, and to name no camera-surface or segmentation type.

**Alternative considered and rejected**: extracting a shared
`presentation/shared/file-download.ts` so the `download` exemption is one file for the whole
application. It is tidier and was proposed during investigation, but it edits working Milestone 2 code
for a cosmetic gain, with a real (if small) risk of destabilising project export, and this milestone's
governing principle is minimalism. Recorded here so it can be picked up deliberately later.

---

## D8 — The live preview reuses `Stage`; sample review draws nothing at all

**Decision**: the capture preview constructs a `Stage` and calls
`stage.present(surface, [], landmarkOverlayCommands(frame, rendererConfig))` — no effect runtime, no
commands of its own. The sample **review** list renders each sample as inline SVG built from its
stored landmark coordinates.

**Rationale**: `Stage` is already the one component that composites the camera and draws, and
`landmarkOverlayCommands` already exists. Reusing both means Capture Mode introduces no second
drawing path, which is the rule Milestone 2 made binding on the editor and which applies here for the
same reason. For review thumbnails, SVG built from coordinates touches no canvas API at all — so the
sample list is fully testable in jsdom, and there is structurally no place a camera pixel could
appear in it (FR-052, the "no imagery in review" rule in Out of Scope).

---

## D9 — Fixture verification compares parsed structure, including key order

**Decision**: `scripts/export_web_capture_fixtures.py` writes
`apps/web/test/fixtures/pose_sample_cases.json` — an array of cases, each holding the **inputs**
(pose identity, session metadata, per-hand raw landmarks) and Engine's **serialized document** for
those inputs, produced by `PoseSerializer.to_dict`. A comparator in the Web suite asserts a
structural match as FR-066 defines it.

**Key order is comparable without byte comparison**: both `JSON.parse` and `JSON.stringify` preserve
insertion order for non-integer string keys, and every key in this schema is such a key. So
`Object.keys(expected)` is Engine's on-disk order and `Object.keys(actual)` is Web's emission order,
and comparing those two arrays is a real assertion, not an approximation.

**Why not byte-for-byte**: Python renders `2.79e-07` and JavaScript renders `2.79e-7` for the same
IEEE-754 double. The values are identical; only the text differs. A byte comparison would fail on a
non-difference, and the natural "fix" would be a custom number formatter — new code, new bugs, and no
benefit. Exact numeric equality on parsed doubles is the stronger check anyway: it cannot be fooled by
matching text that came from a different value.

**Cases** (FR-065): one hand; two hands; countdown enabled; countdown disabled; absent optional
fields (no `display_name`, no `description`); and a numeric-stress case carrying very small
magnitudes, negatives, and full-precision doubles.

---

## D10 — Non-determinism is injected, so the domain stays environment-free

**Decision**: two small ports — a clock (`() => Date`) and an id factory (`() => string`) — are
injected into the capture application layer. `crypto.randomUUID()` and `Date` are constructed only in
the composition root.

**Rationale**: the domain must be testable with no browser (FR-060), and a serializer that reads the
wall clock cannot be fixture-compared at all. This is the same discipline `Session` already applies
with its injected `now`.

---

## D11 — Capture configuration is a data file, like everything else tunable

**Decision**: `apps/web/config/capture.json`, loaded and validated by
`src/infrastructure/config/capture-config-loader.ts` into a typed
`src/domain/config/capture-config.ts`, following `session-config-loader.ts` exactly — including its
`rejectUnknownKeys` strictness.

Initial values: countdown 3000 ms (0 disables), burst size 5, burst interval 200 ms, contributor
label pattern `^[a-z0-9][a-z0-9_-]{1,23}$`, pose id pattern `^[a-z0-9_]+$`, undo depth 50.

**Rationale**: Principle V, restated for the browser by the Web standards section: tunable values are
data, never literals at call sites (FR-072). The label pattern being configuration is what makes
"an email address cannot be entered" a testable rule rather than a hope.

---

## D12 — Undo/redo is a bounded snapshot stack in the application layer

**Decision**: an `EditHistory` holding `Project` snapshots, bounded to the configured depth
(default 50), owned by editor application state. Every existing `Project → Project` edit function is
untouched; the history simply records the value each returned.

**Rationale**: `future-work.md` says an undo stack here "is a list of snapshots and a pair of commands
rather than a redesign", and it is right — because the edits are already pure. Snapshots rather than
inverse operations because there is nothing to invert: the previous value *is* the undo. Bounded
because an unbounded list of whole-project snapshots is a memory leak with a nice name. It lives in
application state, never in a project document (FR-076), so nothing about what a project *is* changes.

---

## D13 — What `session_uuid` means in a Web sample

**Decision**: Web's `CaptureSession` — one operator, one pose, opened and closed explicitly — is what
`metadata.capture.session_uuid` names. Its granularity differs from Capture's, where a session is one
Record press.

**Rationale**: the key's meaning is "the recording session that produced this sample", and that is
true in both applications. The field is opaque to Engine, which stores it as a string. Recording the
difference in granularity in the schema contract is what keeps it a documented difference rather than
a silent one — the same handling Capture's own contract gives to its additive fields.

---

## D14 — `check-prerequisites.sh` on this machine (no repository change)

**Finding**: `jq` is **not** a project prerequisite. Every call site is guarded by
`command -v jq`, and `common.sh:94` documents the intended fallback chain `jq → python3 → grep/sed`.

**The actual defect** is in that chain, in upstream Spec Kit code: on this machine `python3` resolves
to the Microsoft Store stub, which *exists* (so `command -v python3` succeeds and the branch is
taken), prints an install notice to stderr, exits **0**, and produces empty stdout — so the script's
`if ! _fd=$(python3 …)` guard cannot catch it either. The working `grep/sed` last-resort branch sits
in the `else` of that `elif` and is therefore unreachable. Run directly, it returns the correct value.

**Decision**: no repository change, no specification change, no weakened check. The minimal local fix
is to disable the `python3.exe` App Execution Alias (Windows Settings → Apps → Advanced app settings →
App execution aliases), after which `command -v python3` fails and the correct fallback runs.
Installing `jq` also works but is a workaround, not a requirement. Until then, invoking the scripts
with `SPECIFY_FEATURE_DIRECTORY=specs/009-web-capture-mode` set is sufficient and changes nothing.
