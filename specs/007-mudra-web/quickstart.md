# Quickstart — Mudra Web

**Feature**: `007-mudra-web` | **Date**: 2026-08-20

How to build, run, and **validate** the vertical slice. Each scenario maps to acceptance criteria in
[spec.md](./spec.md). This is a validation guide, not an implementation guide.

---

## Prerequisites

| Need | Detail |
|---|---|
| Node.js | 20 LTS or newer |
| Python | The repository's existing environment, for the two build scripts |
| Webcam | Any; the default device is used |
| Dataset | `datasets/poses/` present (1,378 samples across 18 poses) |
| Model | `assets/hand_landmarker.task` present (7.8 MB) |
| Browser | Chromium, Firefox, or Safari, current version |

> On this machine, Speckit commands need `SPECIFY_FEATURE_DIRECTORY=specs/007-mudra-web` because `jq`
> is absent and `python3` resolves to a non-functional stub. Local tooling condition only; nothing in
> the repository depends on it.

---

## Build the data (run from repository root)

```bash
# Golden fixtures for the TypeScript ports — verified against Engine's own implementation
python scripts/export_web_fixtures.py

# The browser exemplar bundle — ~574 KB from 16 MB of dataset JSON
python scripts/export_web_exemplars.py
```

Expected from the exemplar export:

```
Scanned   18 catalog poses, 1378 samples
Included  17 poses, 2333 hands
Excluded   1 pose:  domain_expansion (1 sample, below minimum of 20)
Wrote     apps/web/public/exemplars.manifest.json
          apps/web/public/exemplars.bin   (573.8 KB)
```

**The exclusion line is required output, not a warning to suppress** — FR-023a forbids a pose
disappearing silently.

---

## Run

```bash
cd apps/web
npm install
npm run dev          # http://localhost:5173
```

```bash
npm test             # domain + architecture suites (no browser needed)
npm run typecheck
npm run lint
npm run build        # production build; copies the shared model into dist/
```

---

## Validation scenarios

### 1. The core loop — User Story 1 (P1)

1. Open the app; click to grant camera access.
2. See yourself, **mirrored**, with no landmarks, no numbers, no technical text.
3. Form a supported pose (default active pose set: `hi`, `peace`, `tp`, `dragon`).
4. A visible build-up appears; after **1.0 s** the effect plays.
5. Release and repeat.

✅ **Pass**: an effect fires within 200 ms of confirmation, and the default screen shows zero technical
readouts. — *SC-001, SC-005, SC-012*

### 2. Confirmation fires once — FR-034

Hold a supported pose continuously for 15 seconds.

✅ **Pass**: **exactly one** playback. Break the pose and re-form it → a second playback. — *SC-003*

### 3. Mirroring is correct — the high-risk area

1. Enable debug mode.
2. Raise your **right** hand alone.

✅ **Pass**: the label reads `right`, and landmarks sit **on** your hand as displayed — not
horizontally opposite it. — *FR-009–FR-013, SC-008*

> This is the failure mode with no exception attached: a mirror bug simply produces worse matches. The
> automated counterpart (`test/domain/mirroring.test.ts`) feeds a known-convention input and asserts
> known handedness and known normalized coordinates, so the suite catches it rather than a human
> noticing degraded recognition.

### 4. Ports match Engine — FR-019, FR-029

```bash
npm test -- normalization matcher
```

✅ **Pass**: 100% of golden-fixture cases match — normalization within `1e-9`, matching within `1e-5`
relative (float32 bundle precision). — *SC-007*

### 5. Effects are data — User Story 2 (P2)

1. Edit `apps/web/config/effects.json`: change a colour, a `duration_ms`, and an `anchor`.
2. Reload. Behaviour changes.
3. Add a new effect entry for an active pose with no effect, using only existing action types.
4. Reload. It fires.

✅ **Pass**: both, with **no runtime source modified** (`git status` shows only the config file). — *SC-006*

```bash
npm test -- architecture     # asserts no pose id or effect name is a literal in runtime source
```

### 6. Timelines execute on time — User Story 3 (P2)

Form and hold the **`tp`** pose — the composed effect's trigger (flash at 0 ms, particles at 60 ms,
wash 100–900 ms, trail continuous, audio at 0 ms).

✅ **Pass**: each action begins within **50 ms** of its configured offset; the trail follows your hand
across frames; the scene returns to rest at `duration_ms`. — *SC-014*

### 7. Unavailable capability is visible — FR-077

Trigger the effect containing `person_visibility` with debug mode on.

✅ **Pass**: the debug overlay reports it skipped with reason `capability_unavailable`; the effect's
other actions still play; **nothing pretends to have worked**. — *SC-011*

### 8. Nothing is persisted — Principle II

Run a full session, then in DevTools:

- **Application** tab → Local Storage, Session Storage, IndexedDB, Cache Storage all empty
- **Network** tab → only inbound GETs (model, bundle, config, assets); no POST, no WebSocket, no beacon

✅ **Pass**: all empty; no outbound data. — *SC-010*

```bash
npm test -- privacy          # asserts no storage/readback/upload API is referenced
```

### 9. Excluded pose is reported, not hidden — FR-023a, FR-085

Enable debug mode and open the pose panel.

✅ **Pass**: `domain_expansion` is listed as **ineligible — 1 sample, minimum 20**. Poses that are
eligible but inactive are listed separately as **inactive**. Three populations, three states, none
silent. — *SC-013*

### 10. Bundle is deterministic — FR-081

```bash
python scripts/export_web_exemplars.py && cp apps/web/public/exemplars.bin /tmp/a.bin
python scripts/export_web_exemplars.py && cmp /tmp/a.bin apps/web/public/exemplars.bin
```

✅ **Pass**: `cmp` reports no difference. — *SC-009*

### 11. Performance is measured — FR-093, FR-095

Enable debug mode; observe for 30 seconds, then trigger an effect.

✅ **Pass**: sustained ~30 fps; recognition latency ≤ 200 ms; **trigger-to-first-paint ≤ 200 ms**; all
three **displayed**, not assumed. — *SC-004, SC-005*

> Trigger-to-first-paint is measured from the pose event that satisfies a trigger, to the first
> `requestAnimationFrame` callback after the renderer issues that playback's first draw call. The
> browser exposes no per-element paint timestamp, so that callback is the practical proxy; the
> boundaries are documented in `apps/web/README.md`.

### 12. Recognition reliability — SC-002

The one scenario that answers *"does this actually work?"* Run it only once the implementation exists.

For **each** pose in the active pose set (`hi`, `peace`, `tp`, `dragon`):

1. From the default experience, deliberately form the pose and hold it until it resolves.
2. Release fully, return to a neutral position, and repeat — **10 attempts** per pose.

Count an attempt as a **success** when a deliberate, correctly-formed pose produces its intended
effect. Count a **failure** when nothing triggers, when a different pose triggers, or when an effect
fires that the user did not intend.

✅ **Pass**: **at least 8 of 10** for each active pose. Record the per-pose and overall rates in
`apps/web/README.md`. — *SC-002*

> If a pose falls short, that is a finding about the active pose set or the dataset — report it.
> **Do not lower the confidence floor or the ambiguity margin to reach the number** (FR-028). The
> sanctioned remedies are a more distinct active pose set, or more recorded samples for that pose.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Nothing recognized, ever | Bundle missing or stale — re-run the export; check the fingerprint warning |
| Handedness inverted | Mirroring regression — run scenario 3 and the mirroring test |
| Confidence never clears 0.5 | Active pose set too large or contains near-identical poses. **Widen distinctness, never lower the floor** (FR-028) |
| Effect never fires but the pose is recognized | Trigger's `pose_id` is outside the active pose set — visible in the debug pose panel |
| Silent effects | Audio blocked until the camera-grant gesture; check debug diagnostics |
| Frame rate below 30 | Check the delegate in use; do **not** add a worker before profiling (FR-097) |

---

## Reading order for a new contributor

1. [spec.md](./spec.md) — what is being built and why
2. [research.md](./research.md) — the 14 decisions, especially D1 (mirroring) and D11 (active pose set)
3. [data-model.md](./data-model.md) — the types
4. [contracts/render-commands.md](./contracts/render-commands.md) — the runtime/renderer seam
5. [contracts/engine-consumption.md](./contracts/engine-consumption.md) — why Web imports nothing
