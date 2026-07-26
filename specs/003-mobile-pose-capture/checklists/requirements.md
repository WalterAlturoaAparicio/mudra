# Specification Quality Checklist: Mudra Capture — Mobile Pose Dataset Collector

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-24
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

## Validation Notes

**Iteration 1 findings and fixes:**

- *Implementation leakage*: the framework, platform-channel, and archive-format details present in
  the raw input were removed from requirements; the Input quote retains them as provenance only.
  "Android first" survives in Assumptions as a product constraint, not a requirement.
- *Unbounded quality claims*: "high-quality samples" was made testable by defining acceptance as
  the engine's own validation rules (FR-019, SC-004) rather than a subjective judgment.
- *Ambiguous capture duration*: "approximately one second" is pinned to a configurable 1.0 s default
  with a derived, testable outcome (SC-002: ≥20 samples per press).
- *Schema compatibility*: stated as a hard requirement against the existing engine contract
  (FR-025–FR-029) with a zero-manual-processing outcome (SC-005) rather than a vague "compatible".

**Deliberate constraints carried from governance** (constitution v1.2.0):

- Principle II — FR-030/FR-031 and SC-008 forbid persisting any pixel data and confine reference
  images to UI guidance.
- Principle III — FR-004/FR-018/FR-026/FR-029 keep `pose_id` identity and append-only collections.
- Principle VI — FR-040/FR-041 fence off recognition, gameplay, and every deferred feature.
- Monorepo section — FR-025/FR-033 make the JSON schema the only contract with the engine.

**Clarification session 2026-07-24 (post-`/speckit-clarify`) — re-validation:**

All 16 checkbox items remain passing (16/16 → 16/16); no regressions. Four clarifications were
integrated and tightened previously under-specified areas:

- *Hand count per pose* — was an assumption ("one or two hands are both valid"), now a testable
  requirement pair (FR-002, FR-019a/FR-019b) with its own outcome (SC-012) and acceptance scenario.
- *Camera facing* — was an assumption, now a requirement (FR-037a) because it determines handedness
  semantics in stored data, not just presentation.
- *Reference images* — FR-005 now specifies asset resolution by `pose_id` plus placeholder fallback,
  so "no artwork yet" cannot block delivery.
- *Export delivery* — FR-035 replaced a vague "tell the user where it is and/or share" with a single
  testable mechanism (system share sheet).

**Post-analysis refinement pass 2026-07-24 — re-validation:**

All 16 items still pass (16/16 → 16/16); no regressions. The spec grew from 44 to 55 functional
requirements and 12 to 17 success criteria, closing every finding from the cross-artifact analysis:

- *CRITICAL D1* → FR-042/FR-043 define the structured startup and shutdown records Principle V
  mandates, with SC-017 making them verifiable.
- *HIGH E1* → FR-044 makes front-camera selection explicit, mirroring mandatory, the selection
  recorded in metadata, and unsupported configurations a hard rejection.
- *HIGH E2* → SC-001 is designated the primary product KPI with an explicit 5-minute benchmark
  procedure and pass criterion.
- *MEDIUM E3/E4/F1* → FR-012 (reference visible during countdown), FR-049/FR-050 (orientation lock
  and safe abort), and a plan↔tasks phase cross-reference table.
- *LOW A1/B1/C1* → a Glossary fixes Sync vs dataset-export terminology, and FR-051 defines the
  sample-limit behaviour.

New capability, still within scope: session identity (FR-045/FR-046), export manifest (FR-047),
integrity validation (FR-048), and an explicit backwards-compatibility rule (FR-052) that keeps the
engine's schema v1 intact.

**Traceability check**: every new FR has at least one task (T070–T081) and, where user-observable, a
quickstart row (2b, 21–28) and a success criterion (SC-013…SC-017).

### Revision R1 re-validation (2026-07-25)

R1 folded the former specification 004 into this one — camera lifecycle, preview aspect ratio, capture
modes, lens switching, conditional countdown, session loop, camera metadata, layout, stability, and the
camera abstraction. All 16 items still pass (16/16 → 16/16); no regressions. The spec grew from 55 to
116 functional requirements (119 counting lettered sub-requirements) and from 17 to 32 success criteria.

Five clarifications were resolved during the revision and are recorded in *Clarifications → Session
2026-07-25*. Two earlier clarification answers are annotated as superseded rather than deleted, so the
record of what was believed when remains intact.

**Requirement-completeness note on E1**: the *HIGH E1* finding above was originally closed by making
front-camera capture mandatory. R1 permits the rear lens, so that closure is restated rather than
reversed — FR-053–FR-058 convert non-canonical captures before storage, which preserves the
anti-corruption guarantee E1 demanded while allowing both lenses. FR-044 retains the rejection rule for
configurations that genuinely cannot be recorded correctly.

**Consistency gaps introduced by R1** — status after `/speckit-plan` (2026-07-26):

- ✅ `plan.md` — regenerated for R1: Constitution Check re-evaluated against v1.3.0, R1 design
  section, capability phases H–N, and the six hardware-only criteria called out explicitly.
- ✅ `research.md` — decisions **D14–D22** added, each naming the existing behaviour it replaces. D1
  and D12 carry superseded pointers rather than being rewritten.
- ✅ `data-model.md` — canonical-convention wording adopted throughout, `raw` → `canonicalRaw`
  (FR-056), new camera domain, camera-session lifecycle, failure taxonomy, conversion rules, and the
  revised take state machine.
- ✅ `contracts/sample-json.md` — carries all five additive fields, the redefined meaning of `raw`,
  and the placement rationale.
- ✅ `contracts/camera-channel.md` — **new**, covering lens selection (FR-065–FR-070), total release
  (FR-086), and true preview dimensions (FR-099). `contracts/platform-channel.md` is now a superseded
  redirect with no implementable content.
- ✅ `contracts/interfaces.md` — `CameraSource`/`CameraSession`, `CameraSessionController`,
  `CanonicalViewConverter`, the camera-failure taxonomy, and the lifecycle log events.
- ✅ `quickstart.md` — validation rows 29–44, a dedicated hardware-only camera-lifecycle section
  (L1–L6), and the SC-028 throughput comparison.
- ✅ `tasks.md` — regenerated: baseline phases 1–7 kept as the record of merged work, R1 phases 8–16
  added (T082–T138), and T037/T037a marked superseded and replaced by T098/T099.

### R1.1 post-analysis re-validation (2026-07-26)

The cross-artifact analysis pass produced 0 CRITICAL and 1 HIGH finding; all six were accepted and
applied. All 16 checklist items still pass (16/16 → 16/16). Requirement and criterion counts are
unchanged (119 FRs, 32 SCs) — R1.1 revised wording and scope, it did not add requirements.

| Finding | Severity | Resolution |
|---|---|---|
| **E1** Countdown/confirmation controls built in a P3 phase that P1 and P2 stories depend on | HIGH | Ordering fixed: T111a (confirmation, Phase 10/P1) and T115a (countdown, Phase 11/P2); T130 now only positions the finished bar |
| **C1** FR-115 had zero tasks | MEDIUM | FR-115 extended to require **automatic** enforcement; T133a adds the layer-boundary architecture test |
| **F1** Orientation unhandled between takes | MEDIUM | **FR-049 revised**: locked for the whole capture session, restored on leaving. T086a implements it. The only behaviour change in R1.1 |
| **A1** "Session" used for three scopes, two named | MEDIUM | Glossary → *The three sessions*; FR-071 now states that re-entry without a mode change does not re-initialize; T082a renames the colliding types |
| **C2** SC-030 verified only implicitly | MEDIUM | FR-116 extended to the complete pipeline; T091 extended and T133b adds the end-to-end no-hardware integration test |
| **C3** SC-023 untracked | LOW | Added as quickstart manual row 47 |

**Requirement-completeness note**: `session_uuid` still identifies a **recording session**. A1 renamed
a concept in prose, never a persisted field — `schema_version` stays `1` and no fixture changes.
- ⏳ **Engine-side follow-ups**, both disclosed rather than resolved, and neither gating this feature:
  (1) `PoseSerializer` re-emits only the keys it knows, so a load-then-resave drops all five additive
  fields — verified by reading `apps/engine/dataset/serializer.py`, which uses explicit key lookup on
  plain dataclasses and therefore *reads* R1 samples correctly today; (2) the engine's documentation
  of `HandSample.raw` is stale now that FR-056 redefines its meaning without renaming it.

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.
- All 16 checklist items pass. The **spec and every design artifact are consistent and ready**;
  `tasks.md` is the last artifact predating R1 and needs regeneration before implementation.
