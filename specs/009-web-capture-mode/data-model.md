# Data Model: Mudra Web — Gated Web Capture Mode

**Feature**: `009-web-capture-mode` | **Date**: 2026-09-07

The smallest model that satisfies the specification. Every field below exists because a functional
requirement or the canonical schema needs it; nothing is present "in case it is useful later".

All types are immutable value objects in `src/domain/capture/`, framework-free and constructible in a
plain Node test with no browser, no camera and no storage attached (FR-060).

---

## CaptureSession

One operator's recording session for exactly one pose. It is the unit of review, deletion and export,
and it is what `metadata.capture.session_uuid` names in an exported sample (research D13).

| Field | Type | Source | Why it exists |
|---|---|---|---|
| `id` | string (UUID v4) | injected id factory | Stable identity; becomes `session_uuid` (FR-031) |
| `contributorLabel` | string | operator | Dataset provenance (FR-005); becomes `contributor_label` |
| `poseId` | string | operator | The pose being collected (FR-012); becomes `pose_id` |
| `displayName` | string \| null | exemplar data, else operator | Becomes `display_name` (FR-014a) |
| `requiredHands` | 1 \| 2 | exemplar data, else operator | Validation input (FR-014, FR-017) |
| `status` | `'active' \| 'closed'` | lifecycle | Which session a take appends to (FR-012) |
| `startedAt` | string (ISO-8601 UTC) | injected clock | Manifest session record (FR-048) |
| `sampleCount` | number | derived | Displayed continuously (FR-020); a stored counter, not a scan |
| `discardedCount` | number | derived | Rejected-frame count (FR-019); manifest record |

**Invariants**

- `poseId` matches the configured pose-id pattern (`^[a-z0-9_]+$`) — FR-013.
- `contributorLabel` matches the configured label pattern — length- and character-limited so an email
  address or full name cannot be entered (FR-005, Edge Cases).
- `requiredHands` is 1 or 2. When the pose exists in the loaded exemplar data, it is taken from there
  and is not operator-editable (FR-014).
- `displayName` is never used as an identifier (Principle III).
- A session holds samples for exactly one `poseId`; changing pose means a new session.
- `sampleCount` and `discardedCount` are never negative, and `sampleCount` always equals the number of
  stored samples carrying this session's id.

**Lifecycle**

```text
        create (label + poseId + requiredHands validated)
                       │
                       ▼
                   ┌────────┐   take accepted / sample deleted
                   │ active │◄──────────────────────────────────┐
                   └───┬────┘                                   │
                       │ close (explicit)                       │
                       ▼                                        │
                   ┌────────┐   reopen is NOT modelled ─────────┘
                   │ closed │
                   └───┬────┘
                       │ delete session (explicit, confirmed)
                       ▼
                   (removed — no tombstone, FR-044)
```

There is no reopen transition and no automatic close. A session becomes `closed` only when the
operator says so; a closed session is still reviewable, deletable and exportable. Export changes no
state at all (FR-052a).

---

## CaptureSample

One accepted observation. It is the only thing in the model that carries landmark data, and it carries
nothing that could hold an image.

| Field | Type | Why it exists |
|---|---|---|
| `id` | string (UUID v4) | Becomes `sample_uuid`; globally unique so duplicates are detectable (FR-052b) |
| `sessionId` | string | Ownership; the deletion and export unit |
| `capturedAt` | string (ISO-8601 UTC, Engine format) | Becomes `timestamp` and `metadata.timestamp` (research D3) |
| `frameWidth` | number | Becomes `metadata.camera.width` |
| `frameHeight` | number | Becomes `metadata.camera.height` |
| `countdownStartedAt` | string \| null | Becomes `capture.countdown_start_time` |
| `countdownSeconds` | number | Becomes `capture.countdown_seconds` |
| `countdownEnabled` | boolean | Becomes `capture.countdown_enabled` (FR-031) |
| `hands` | readonly CaptureHand[] | The landmark payload |

**CaptureHand**

| Field | Type | Why it exists |
|---|---|---|
| `handedness` | `'left' \| 'right' \| 'unknown'` | Becomes `hands[].handedness` |
| `confidence` | number in [0,1] | Becomes `hands[].confidence` |
| `raw` | 21 × `{x, y, z}` | The earliest **canonical** observation — becomes `hands[].raw` |
| `normalized` | 21 × `{x, y, z}` | `normalize(raw)` — becomes `hands[].normalized` |

**Invariants**

- `hands.length ≥ 1` and `≥ session.requiredHands` (FR-017).
- Every hand carries exactly 21 landmarks (FR-017).
- Every coordinate is finite — no `NaN`, no `±Infinity` (FR-017).
- `normalized` is the output of the application's existing `normalize()` applied to `raw`; there is no
  second normalization anywhere (FR-024).
- `raw` is written exactly as the detector produced it, in the mirrored (selfie) space the detector
  already worked in. **No coordinate is ever flipped** (FR-026).

**Why an image cannot get in here** — every field above is a number, a string, a boolean, or an array
of the same. There is no `unknown`, no `Blob`, no `ImageBitmap`, no `MirroredSurface`, no
`SegmentationFrame`, and no index signature anywhere in this graph. Persisting a frame is not an error
of discipline that a review might miss; it is a type error (FR-040).

---

## CaptureValidationOutcome

The gate between a detected frame and a stored sample. Ported from Mudra Capture's
`PoseSampleValidator`, preserving its reasons verbatim so the two applications reject the same frames
for the same stated reasons (FR-018).

```text
accepted
rejected('no_hands')                 — nothing in frame
rejected('insufficient_hands')       — fewer hands than the pose requires
rejected('wrong_landmark_count')     — a hand without exactly 21 points
rejected('non_finite_coordinates')   — a NaN or infinite coordinate
```

The validator never judges whether the operator performed the *correct* pose. That would be
recognition, and Capture Mode does none (FR-022, FR-025).

---

## CaptureConfig

Loaded from `config/capture.json` and validated at startup with strict unknown-key rejection, mirroring
`session-config-loader.ts` (FR-072, research D11).

| Field | Initial value | Governs |
|---|---|---|
| `countdownMs` | 3000 | Delay before the first sample; `0` means disabled |
| `burstSize` | 5 | Samples per take |
| `burstIntervalMs` | 200 | Spacing within a burst |
| `contributorLabelPattern` | `^[a-z0-9][a-z0-9_-]{1,23}$` | Makes "no PII" a testable rule |
| `poseIdPattern` | `^[a-z0-9_]+$` | The dataset's existing identity rule |
| `undoDepth` | 50 | Editor history bound (FR-075a) |

`countdownMs: 0` sets `countdownEnabled: false` and `countdownSeconds: 0.0` on every sample of that
take, with `countdownStartedAt` set to the instant the take was triggered — the zero-length countdown
convention Mudra Capture already established.

---

## CaptureRepository (port)

`src/domain/ports/capture-repository.ts`. The only way capture data reaches storage. It knows nothing
about projects, and the project repository knows nothing about it (FR-037, FR-061).

```text
createSession(session)              store a new session
listSessions()                      every stored session, newest first
closeSession(id)                    status → closed
deleteSession(id)                   remove the session AND all its samples (FR-043)
appendSample(sample)                store one accepted sample (FR-021)
listSamples(sessionId)              that session's samples, capture order (FR-041)
deleteSample(id)                    remove one sample, adjust its session's count (FR-042)
countAll()                          total stored samples, for export availability (FR-051)
```

There is no `update`, no `markExported`, and no soft-delete flag. Deletion removes records
(FR-044, FR-045); export does not mutate anything (FR-052a).

---

## EditHistory (P3, editor only)

`src/domain/editor/edit-history.ts`. A bounded stack of `Project` snapshots, held in editor
application state.

| Operation | Behaviour |
|---|---|
| `record(project)` | Push; discard the redo branch; drop the oldest beyond `undoDepth` |
| `undo()` | Previous snapshot, or nothing when empty |
| `redo()` | Next snapshot, or nothing when the redo branch is empty or was discarded |

Snapshots rather than inverse operations, because every editor edit is already a pure
`Project → Project` function and the previous value *is* the undo (research D12). It is never
persisted, never touches capture data, and adds no field to a project document (FR-076, FR-077).

---

## Entity relationships

```text
CaptureConfig ──(validates)──► CaptureSession ──1:N──► CaptureSample ──1:N──► CaptureHand
                                     │                       │
                                     │                       └──► 2 × 21 Landmark {x,y,z}
                                     │
                                     └──(session_uuid, contributor_label)──► exported sample metadata

CaptureSession + CaptureSample ──(serializer)──► canonical pose-sample document ──► archive entry
                               ──(manifest builder)──► manifest.json  (inert, not the schema)

Project / ProjectRepository ──── no relationship in either direction (FR-061) ────
```
