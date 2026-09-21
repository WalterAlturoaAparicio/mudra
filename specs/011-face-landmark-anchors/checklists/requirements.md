# Specification Quality Checklist: Face Landmark Anchors

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-21
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details leak into the requirements *(with one repository-convention exception: the "Technical Constraints" section records verified facts about the current tree, exactly as specs 009 and 010 do, so the plan does not re-derive them. Requirements FR-001–FR-037 are stated in terms of behaviour and domain concepts.)*
- [x] Focused on user value (an author can anchor an existing effect to a face point) and on the constitutional conditions that make it safe
- [x] Written so a non-implementer can follow the decisions (D1–D14) and their rationale
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain (every constitution-delegated decision is resolved in "Clarifications"; genuinely unresolvable items are listed under "Unresolved items")
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria avoid implementation detail (SC-010 is explicitly manual and is not claimed as verified)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded (stages table; Out of Scope; Unresolved)
- [x] Dependencies and assumptions identified (A-1–A-9; two are explicitly unverified: A-3 licence, A-4 landmark count)

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows (anchor, gating, unavailable, leak-proofing, authoring)
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] Every open decision delegated by constitution v1.10.0 is resolved or explicitly deferred

## Constitution Consistency (feature-specific)

- [x] Stages: implements 1, 2 and the point-anchor part of 3; defers regions, effects, mesh (Principle VI staging clause)
- [x] No dormant surface: no new action, command, region name, blendshape channel, or scaffolding for a later stage
- [x] Model: only via a shared asset under `assets/`, absent by default, pinned-source script, hash + provenance, no runtime download (FR-023–FR-027)
- [x] Domain boundary: framework-free `FaceFrame`/`FaceDetector`; layering test extended (FR-009–FR-013)
- [x] Anchors: `AnchorResolver` remains the sole resolver; existing actions reused unchanged (FR-014–FR-015b)
- [x] Privacy: no readback/screenshot/recording/serialization/upload/persistence; no new scan exemption (FR-033, SC-007)
- [x] Recognition boundary: face data cannot reach matcher, pose events or triggers (FR-028)
- [x] Capture/pose-sample schema/docking/undo-redo untouched (Existing constraints)
- [x] Canvas2D remains the required renderer; no WebGL/WebGPU/mesh

## Notes

- Two assumptions are deliberately marked **not verified** because nothing was downloaded or run in this pass: the model's licence (A-3) and its landmark count (A-4). Both are gated by the provisioning change.
- SC-010 (real-browser behaviour and frame rate) requires a human pass and is not automated.
- Ambiguities noted at specification time were settled by the plan and, after the 2026-09-21 analysis, promoted into the spec: detector lifecycle (D16/FR-021), project schema version (D18/FR-015d), capability probe shape (D17/FR-001–003), landmark-count ordering (D21), Definition of Done (D22).
- Completion requires the Definition of Done, not merely green automated gates.
