# Specification Quality Checklist: Mudra Web — Pose-Driven Effect Runtime

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-20
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

## Notes

### Validation findings

**"No implementation details" — passes with a documented, deliberate exception.**
The functional requirements are written in capability terms throughout: FR-014 says "detect up to two
hands", not "call MediaPipe"; FR-066 says "produce declarative render instructions", not "emit
RenderCommand objects"; FR-096 says "driven by the browser's video-frame delivery", not
`requestVideoFrameCallback`. Named technologies appear **only** in the clearly-labelled *Technical
Constraints (given, not derived)* section, which explicitly states they are stakeholder-supplied
milestone constraints rather than derived requirements. This placement was chosen so the requirements
survive a change of toolchain — and because constitution v1.6.0 states that build tooling is a
plan-level decision, not a constitutional one.

**Numeric recognition constants are requirements, not implementation details.**
The weights (0.5 / 2.0 / 1.0), confidence floor (0.5), ambiguity margin (0.12), and minimum sample
count (20) appear in FR-020, FR-026, FR-027, and FR-085. These are *behavioural contracts* inherited
from the established recognition semantics, and FR-028 explicitly forbids altering them. Omitting them
would have made those requirements untestable, which the "testable and unambiguous" criterion outranks.

**All clarifications are resolved** (updated after the `/speckit-clarify` pass, session 2026-08-20).
Four questions were asked and answered; each is recorded in the spec's *Clarifications* section and
integrated into the affected requirements:

| Question | Answer | Requirements updated |
|---|---|---|
| Confirmation hold duration | 1.0 second (semantics unchanged) | FR-033 |
| Exemplar bundle / matching scope | Bundle all eligible poses; match a configured active set | FR-024, FR-024a (new), FR-025, FR-080 |
| "Background change" semantics | Full-screen tinted overlay composited over the camera view | FR-053 |
| Audio in this milestone | Included | FR-054a (new) |

The second question was **not** in the original specification — it surfaced during the ambiguity scan.
It is the highest-consequence of the four: confidence is a softmax across all eligible candidates, so
the 0.5 floor requires the top pose to dominate every rival. With all 17 bundled poses active — several
of which are near-identical two-handed interlocks — that floor would rarely be passed, and FR-028
forbids compensating by lowering it. Left unresolved, the milestone could have been built correctly and
still appeared not to work.

**Success criteria are technology-agnostic.** SC-004 states "approximately 30 updates per second" as a
smoothness outcome rather than a frame-rate implementation target; SC-009's 2 MB is a user-facing load
cost; SC-010 is verifiable by observation of storage and network rather than by code inspection.

**Known dataset limitation is surfaced, not hidden.** FR-085 and the Edge Cases section both record
that `domain_expansion` currently holds 1 sample against a minimum of 20 and will therefore not be
recognizable, and FR-028 forbids lowering the threshold to compensate.

### Status

All 16 checklist items passed on the first validation iteration and **all 16 still pass** after the
clarification pass (16/16 → 16/16; no item changed state). No open questions remain. The
specification is ready for `/speckit-plan`.
