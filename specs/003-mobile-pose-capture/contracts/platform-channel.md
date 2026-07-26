# SUPERSEDED — Landmark Platform Channel (Kotlin ⇄ Dart)

**Feature**: 003-mobile-pose-capture | **Superseded**: 2026-07-26 by **Revision R1**

**This contract is no longer in force.** It is replaced by
[camera-channel.md](./camera-channel.md).

The pre-R1 contract described a channel that:

- exposed `start` / `stop` / `dispose`, splitting release across two calls;
- bound `CameraSelector.DEFAULT_FRONT_CAMERA` unconditionally and failed with
  `camera_configuration_unsupported` on any other configuration;
- required Dart to assert `lensFacing == 1 && mirrored == true` on every start;
- reported a fixed `720×1280` preview size.

Revision R1 changes all four. The camera is opened with an explicit lens and closed with one total
operation; both lenses are permitted; the preview reports the size actually in use; and the
anti-corruption guarantee that motivated the front-camera-only rule is preserved by **converting
rear-lens captures into the canonical convention before storage** (FR-053–FR-058) rather than by
refusing the lens.

The file is kept so links to it resolve and so the history of the seam stays readable. Nothing here
should be implemented.

→ **[camera-channel.md](./camera-channel.md)** is the current contract.
→ [spec.md → Revision History](../spec.md#revision-history) explains why.
