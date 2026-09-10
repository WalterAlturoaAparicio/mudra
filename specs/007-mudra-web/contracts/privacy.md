# Contract: Privacy & Non-Persistence

**Feature**: `007-mudra-web`

Constitution Principle II binds Mudra Web without exception (v1.6.0): it is a camera application that
**MUST NOT** persist images, video frames, screenshots, or recordings, and **MUST NOT** build any
dataset from captured imagery.

A camera application is exactly where a "save your clip" button appears later by accident, so this
contract is enforced by test rather than by prose.

## The guarantee

| Guarantee | Requirement |
|---|---|
| No camera frame, image, or video is written to any storage | FR-005 |
| No camera imagery leaves the device | FR-006 |
| No recording, capture, screenshot, clip-saving, or sharing capability exists | FR-007 |
| No pose sample or dataset artifact is produced | FR-008 |
| The camera is released when the experience stops or the page is left | FR-004 |

Camera frames exist only as: the live `MediaStream`, one mirrored canvas surface, and the derived
landmark coordinates. Landmarks are numbers, not pixels — Principle II's whole point.

## Prohibited API surface

An automated test scans `apps/web/src/**` and fails on any reference to:

**Storage**: `localStorage`, `sessionStorage`, `indexedDB`, `openDatabase`, `caches`,
`navigator.storage`, `showSaveFilePicker`, `FileSystemWritableFileStream`

**Imagery readback / export**: `toDataURL`, `toBlob`, `captureStream`, `MediaRecorder`,
`getImageData`†, `createImageBitmap`†

**Upload**: `fetch(` with a non-GET method, `XMLHttpRequest`, `navigator.sendBeacon`, `WebSocket`,
`RTCPeerConnection`

† `getImageData` and `createImageBitmap` are listed because they are the readback path by which
imagery escapes a canvas. The prohibition is about imagery leaving memory, not about which API
carries it. If a future requirement genuinely needs one (a segmentation mask, say), the exemption
belongs in that milestone's authorization — added deliberately, with its own review — not quietly to
this allowlist.

## Permitted, and why

| Permitted | Why it is not a violation |
|---|---|
| Reading the exemplar bundle over `fetch` (GET) | Inbound only; contains landmark coordinates, never imagery |
| Reading effect/session configuration and Mudra-owned assets | Application content, not captured data |
| Drawing camera pixels to a visible canvas | Display is not persistence; the canvas is never read back or exported |
| Debug overlay drawing landmarks | Coordinates, drawn live, never stored |

## Verification

1. **Automated**: the source scan above runs in CI as part of the architecture suite.
2. **Manual** (quickstart): run a full session, then confirm empty Application-tab storage
   (Local/Session Storage, IndexedDB, Cache Storage) and a Network tab showing only inbound GETs for
   the model, bundle, configuration, and assets.
3. **Capability**: no UI affordance for recording, downloading, or sharing exists anywhere in the
   application (FR-007).
