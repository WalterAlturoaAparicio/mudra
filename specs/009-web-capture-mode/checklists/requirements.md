# Specification Quality Checklist: Mudra Web — Gated Web Capture Mode

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-07
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Consistency Pass (feature-specific, mandated by the feature request)

Checked before marking the specification complete:

- [x] **Constitution v1.8.0** — every FR traces to the Milestone 3 authorization; no FR exceeds it.
      The four data categories map to FR-040 (what may be persisted) and FR-055 (what may not).
- [x] **`specs/008-effect-editor/future-work.md` section B** — all five points section B said an
      amendment "would need to state, at minimum" are covered: what is stored (FR-031, FR-040),
      consent (FR-006–FR-008), export format and destination (FR-046–FR-052), deletion
      (FR-041–FR-045), and the label scan exemption written narrowly (FR-057).
- [x] **Mudra Capture implementation** — validation invariants preserved verbatim (FR-017, FR-018);
      additive-field precedent followed (FR-031); relationship stated as complementary, not
      replacement.
- [x] **Engine pose-sample schema** — `schema_version` stays 1; no field renamed, removed, or
      reordered; every required field populated (FR-029, FR-030); additive rule respected (FR-031).
- [x] **Web normalization/matching** — reused, not duplicated (FR-024); recognition untouched
      (FR-022, FR-023, FR-025, SC-013).
- [x] **Persistence architecture** — storage confined to the already-permitted directory (FR-039);
      capture store separate from the project store (FR-036–FR-038); isolation enforced by an
      automated check (FR-061).
- [x] **Privacy and architecture tests** — no global relaxation; exactly two file-scoped exemptions
      (FR-057), with every other prohibition restated as still binding (FR-053–FR-056, FR-058).
- [x] **Scope expansion check** — Section A untouched; Section C limited to undo/redo at P3; Out of
      Scope enumerates every adjacent capability that was considered and rejected.

## Notes

- **On "no implementation details"**: the specification names four concrete artifacts — the build
  flag `VITE_MUDRA_CAPTURE=1`, the archive layout `manifest.json` +
  `datasets/poses/<pose_id>/sample_NNNNNN.json`, CRC-32, and verification against Python's standard
  `zipfile`. These are **given constraints**, not derived design: the build flag and the layout were
  fixed by the feature request, and the archive layout is the existing cross-application contract
  Mudra Capture already emits. This matches the convention the repository's prior specs already use
  (spec 008 names `EffectDefinition`, `at_ms`, and `ActionDescriptor.params` for the same reason).
  Storage technology is deliberately *not* named in the FRs — "the one permitted mechanism" — so the
  plan retains that choice.
- **On testability of FR-002 and FR-011**: both are negative requirements ("no new control", "no
  automatic recording"). They are testable the way the repository already tests negatives — a source
  scan and a build-output scan — which is why SC-011 states them as counted outcomes.
- No items required a spec revision; validation passed on the first iteration.
