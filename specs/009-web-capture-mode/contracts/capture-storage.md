# Contract: Capture Storage Boundary

**Feature**: `009-web-capture-mode` | **Date**: 2026-09-07

What Capture Mode stores, where, and how it is kept structurally incapable of holding a camera frame
or of touching the editor's projects.

---

## Location and why it is where it is

| | Editor projects (Milestone 2) | Capture (Milestone 3) |
|---|---|---|
| Directory | `src/infrastructure/persistence/` | **the same directory** |
| Database | `mudra-editor` | `mudra-capture` |
| Object stores | `projects`, `meta` | `sessions`, `samples` |
| Port | `ProjectRepository` | `CaptureRepository` |
| Schema module | `project-schema.ts` | `capture-schema.ts` |

The capture store lives in the directory that already holds the application's only permitted use of
browser storage. This is deliberate and is the narrowest possible change: the privacy scan's
permitted-directory list stays at exactly one entry (FR-039). A new directory would have required
widening that list, which is a real loosening for a tidier folder tree.

The **database** is separate, not merely the store. One connection shared between projects and capture
records is the coupling FR-037 exists to prevent: with two databases, a capture operation cannot
address a project record because it is not in the connection, and clearing capture data cannot reach a
project.

---

## Object stores

### `sessions` — keyPath `id`

```text
{
  id                 string   UUID v4
  contributorLabel   string
  poseId             string
  displayName        string | null
  requiredHands      1 | 2
  status             'active' | 'closed'
  startedAt          string   ISO-8601 UTC
  sampleCount        number
  discardedCount     number
}
```

### `samples` — keyPath `id`, index `by_session` on `sessionId`

```text
{
  id                 string   UUID v4  → becomes sample_uuid
  sessionId          string
  capturedAt         string   ISO-8601 UTC, Engine format
  frameWidth         number
  frameHeight        number
  countdownStartedAt string | null
  countdownSeconds   number
  countdownEnabled   boolean
  hands              [ { handedness, confidence, raw[21], normalized[21] } ]
}
```

Two stores rather than one embedded array: a single sample must be individually deletable (FR-042),
and deleting one of a hundred should not rewrite the other ninety-nine. The index exists so
`listSamples(sessionId)` and `deleteSession(id)` are range operations rather than full scans.

---

## Repository surface

`src/domain/ports/capture-repository.ts` — the only route from the application to storage.

```text
createSession(session): Promise<void>
listSessions(): Promise<readonly CaptureSession[]>          newest first
closeSession(id): Promise<void>
deleteSession(id): Promise<void>                            session AND all its samples
appendSample(sample): Promise<void>                         also increments sampleCount
recordDiscarded(sessionId): Promise<void>                   increments discardedCount only
listSamples(sessionId): Promise<readonly CaptureSample[]>   capture order
deleteSample(id): Promise<void>                             also decrements sampleCount
countAll(): Promise<number>                                 gates export availability
```

**What is deliberately absent**: there is no `updateSample`, no `markExported`, no `deleted` flag, and
no bulk-import. Their absence is the contract — export cannot mutate what it cannot address
(FR-052a), and deletion cannot be faked by a flag that does not exist (FR-044).

An in-memory fake implementing this interface lives in `test/support/fake-capture-repository.ts`, so
every rule about what a session *is* is tested with no browser and no IndexedDB (FR-038, FR-060).

---

## Deletion semantics

| Operation | Effect |
|---|---|
| `deleteSample(id)` | The record is removed from `samples`. Its session's `sampleCount` decreases. |
| `deleteSession(id)` | Every sample with that `sessionId` is removed, then the session record is removed. Both happen in **one transaction**, so a failure leaves neither orphaned samples nor a session missing its samples. |

Deletion is removal. There is no tombstone, no status value standing in for removal, no shadow copy,
and no undo buffer retaining what was deleted (FR-044). After a deletion, opening the database
directly shows the records **absent**, not flagged (FR-045) — which is exactly how the adapter test
asserts it, by reading the store back rather than by trusting a return value.

Export never deletes. Clearing after a verified export is an explicit operator action.

---

## Why a camera frame cannot be stored here

Three independent reasons, in increasing order of strength:

1. **Policy** — FR-040 forbids it.
2. **Path** — the persistence layer never receives a `LandmarkFrame`, a `MirroredSurface`, or a
   `SegmentationFrame`. The conversion from a detected frame to a `CaptureSample` happens in the
   application layer; the repository's signatures accept `CaptureSample` and nothing else. This is why
   the existing privacy assertion over the persistence directory —
   `MirroredSurface | LandmarkFrame | SegmentationFrame.mask` — continues to pass **unmodified** once
   these files exist.
3. **Type** — the persisted record graph is numbers, strings, booleans and arrays of the same. It
   contains no `unknown`, no `any`, no `Blob`, no `ImageBitmap`, and no index signature. There is no
   field an image could be assigned to. Persisting a frame is not a lapse a reviewer might miss; it
   does not compile.

---

## Isolation from project persistence

Enforced by `test/architecture/capture-boundary.test.ts`, not by convention (FR-061):

- No file under `src/**/capture/**` or `src/capture-main.ts` names `Project`, `ProjectRepository`,
  `ProjectSummary`, `EffectDefinition`, or `Timeline`.
- No file under `src/domain/editor/`, `src/presentation/editor/`, or
  `src/infrastructure/persistence/indexeddb-project-repository.ts` names `CaptureSession`,
  `CaptureSample`, or `CaptureRepository`.
- `indexeddb-capture-repository.ts` names `mudra-capture` and never `mudra-editor`;
  `indexeddb-project-repository.ts` names `mudra-editor` and never `mudra-capture`.

---

## Failure handling

| Situation | Behaviour |
|---|---|
| IndexedDB unavailable (private window, blocked site data) | Reported in plain language **before** a session can be started. Capture Mode never collects samples it cannot persist (Edge Cases, FR-071). |
| Quota exceeded mid-session | The take fails with a stated reason; samples already accepted remain intact. |
| Page closed mid-take | Accepted samples are already persisted (FR-021). The in-progress take is lost; nothing is left half-written, because each sample is appended in its own transaction. |
