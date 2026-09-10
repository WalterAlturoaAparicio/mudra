# Contract: Capture Mode Gating

**Feature**: `009-web-capture-mode` | **Date**: 2026-09-07

How Capture Mode is kept out of the public build, what that protects, and — stated as plainly as the
constitution requires — what it does not.

---

## The mechanism

`vite.config.ts` builds explicit entry points. Capture adds a third, conditionally:

```text
input: {
  main:   index.html,
  editor: editor.html,
  ...(process.env.VITE_MUDRA_CAPTURE === '1' ? { capture: capture.html } : {}),
}
```

Nothing in the application imports anything under `src/**/capture/**` or `src/capture-main.ts`.
`capture.html` is the only thing that does, and it is reachable only as a bundler input.

**Why an input rather than a runtime flag**: module graphs are rooted at inputs. Omitting the input
omits the entire capture subgraph — the domain, the repository, the serializer, the archive writer and
every capture view. There is no dead code to tree-shake, no conditional to evaluate at runtime, and no
`if (captureEnabled)` that a future refactor can invert by accident. It is also what makes SC-011
checkable by inspecting the emitted output rather than by trusting a flag (research D1).

**Development**: `VITE_MUDRA_CAPTURE=1 npm run dev` serves `/capture.html`. Without the variable, the
dev server has no capture route either — dev and build agree.

---

## What this guarantees

| Guarantee | How it is verified |
|---|---|
| A default build ships no capture code | `test/architecture/capture-boundary.test.ts` asserts the Vite config gates the input on the flag, and that no non-capture source imports a capture module. Verified end-to-end by building without the flag and confirming `dist/` contains no `capture.html` and no capture chunk (SC-011) |
| A default build behaves exactly as before | No capture module is reachable, so no control, label, storage access, or request can originate from one (FR-002) |
| Capture code cannot leak into the public bundle by import | The boundary test fails if any file outside the capture tree imports from it |

---

## What this does **not** guarantee — stated plainly

**Build-time gating is feature gating. It is not deployment security.**

A build produced *with* the flag contains the capture code, and anyone who can reach that deployment
can use Capture Mode. Nothing in the application authenticates, authorises, or identifies anyone.

- **There is no access control in this feature.** No accounts, passwords, sign-in, OAuth, identity
  system, backend, or server-side database (FR-003).
- **There is no in-browser token, invite code, or passphrase** (FR-004). This was evaluated and
  rejected rather than omitted by oversight: everything the browser receives is public, so a secret
  shipped in a bundle is obfuscation, and presenting it as a security boundary would be a false claim
  the constitution explicitly forbids making.
- **The contributor label is not identity.** It is dataset provenance metadata — a self-chosen,
  pattern-constrained string that says which collaborator produced a batch of samples so the batch can
  be reviewed or withdrawn later. It authenticates nothing, authorises nothing, and is never checked
  against anything (FR-005).

**If access to a deployed capture build must be restricted, that is a hosting-layer concern outside
this feature** — HTTP authentication, an access list, a private URL, or simply not deploying the
capture build publicly. The recommended posture for this milestone is the last one: build the capture
entry point only for the collaborators who need it, and deploy it separately from the public
application.

---

## Threat model, honestly

| Concern | Position |
|---|---|
| A visitor to the public site discovers Capture Mode | Prevented. The code is not in that build. |
| Someone who reaches a capture deployment uses it | **Not prevented by this feature.** Handle it at the hosting layer or by not deploying it publicly. |
| Captured data leaks off the device | Prevented by construction: nothing is transmitted, there is no upload path, and `fetch` remains inbound-GET-only (FR-053, FR-054). |
| A collaborator's samples are attributable to a person | Only to the extent of a short, pattern-constrained label they chose. No name, email, account, device fingerprint, geolocation, or network address is recorded (FR-005, FR-031). |
| A collaborator's browser is shared | Captured samples persist locally until explicitly deleted. The consent text says so, and deletion is one confirmed action (FR-007, FR-043). |

---

## Documentation obligation

`apps/web/README.md` must state, in the section describing the capture build:

1. how to enable it (`VITE_MUDRA_CAPTURE=1`);
2. that it must not be deployed to the public origin;
3. that build-time gating is feature gating, not deployment security;
4. that no in-browser secret is or should be used as an access control.

This is not optional prose. FR-004 requires the limitation be documented rather than implied.
