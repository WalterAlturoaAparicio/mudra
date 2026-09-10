# Contract: Action Descriptor Metadata

**Feature**: `008-effect-editor` | **Producer**: an action's `ActionDescriptor` |
**Consumers**: the inspector, the timeline, the project explorer, `domain/editor/action-status.ts`

FR-072 says a descriptor carries enough metadata for an editor to build a control **without
knowing the action**. This contract states exactly what that metadata is, now that the editor
actually consumes it — because the metadata is the whole agreement between an action author and
every editor surface, and an action author has no other way to influence how their action is
presented.

The rule that shapes all of it: **the runtime reads none of this.** Every field below is authoring
metadata. An action's `update()` behaves identically whether the editor honours it, ignores it, or
does not exist. That is what keeps "add an action" a matter of adding a descriptor, and what stops
presentation concerns leaking into the scheduler.

## The parameter schema

```ts
interface ParamSpec {
  readonly name: string;
  readonly kind: 'number' | 'color' | 'enum' | 'asset' | 'anchor' | 'boolean' | 'string';
  readonly defaultValue: number | string | boolean | Anchor;

  readonly min?: number;          // number: inclusive bounds
  readonly max?: number;
  readonly values?: readonly string[];   // enum: the permitted values
  readonly assetPrefix?: string;         // asset: the required logical prefix

  // Added by the editor UX pass — all three are read generically:
  readonly allowEmpty?: boolean;
  readonly group?: string;
  readonly visibleWhen?: { readonly param: string; readonly values: readonly string[] };

  readonly description: string;   // one line, shown on hover
}
```

| Field | Meaning | Who honours it |
|---|---|---|
| `allowEmpty` | For `asset`: `''` is a permitted value meaning **none chosen** | `resolveParams` accepts it; the picker offers "None"; status treats it as a choice, not a gap |
| `group` | A section heading, e.g. `Emission` / `Motion` / `Appearance` | The inspector groups consecutive params sharing a value |
| `visibleWhen` | Show only while another parameter holds one of `values` | The inspector hides the field in place; the parameter still validates and still has its default |

### `allowEmpty` exists because "not set" must be representable

An optional asset needs a "none" that survives a save/reload round trip. Without it, the only way
to express one would be a sentinel reference deliberately chosen not to resolve — a broken
reference by construction, which is exactly what FR-038's reporting exists to flag as a problem.

### `visibleWhen` hides, it never disables

A hidden parameter is still validated, still defaulted, still whatever the catalog said. It is a
statement about *relevance*, not about permission. `person_visibility` uses it so that choosing
`replace_background` shows the image/colour/fit controls and puts `opacity` away — without the
inspector containing a single branch that names an action.

**Invariant, enforced**: `visibleWhen.param` must name a real `enum` parameter of the same action,
and every value in `visibleWhen.values` must be one of that enum's own. Metadata naming a
parameter that does not exist would silently hide a field forever.

## Presets

```ts
interface ActionPreset {
  readonly name: string;          // author-facing, e.g. `Fountain`
  readonly description: string;   // one line, the button's tooltip
  readonly params: Readonly<Record<string, number | string | boolean | Anchor>>;
}
```

A preset is **a bundle of ordinary parameter values**, applied through the ordinary inspector edit
path. Nothing at runtime ever reads which preset a set of values came from, and there is no second
code path for "a preset burst" versus "a hand-tuned burst".

This is what keeps `particle_burst`'s seven emission patterns one simulation rather than seven
renderer branches — and it is the specific thing item 4 of the editor pass asked for: *"Do not
hardcode each visual pattern as an unrelated renderer branch if the same behavior can be
represented as particle configuration data."*

**Invariant, enforced**: a preset may only set parameters the action actually declares, and the
resulting values must satisfy the action's own schema (`resolveParams` must not throw).

## Action status

`domain/editor/action-status.ts` derives, from this same metadata plus the runtime's own
collaborators, why a clip would or would not do anything:

| Status | Derived from |
|---|---|
| `ready` | Everything below passed |
| `invalid_configuration` | The type is unregistered, or `resolveParams` threw |
| `capability_unavailable` | `requiresCapability` is not in the `CapabilityRegistry` |
| `runtime_error` | The runtime reported `capability_unavailable` for this action on a recent frame |
| `missing_asset` | An `asset` param is set but does not resolve — or the runtime reported `asset_unresolved` |
| `needs_configuration` | A required `asset` is unset, a duration/continuous clip is 0 ms long, or the anchor did not resolve |

Ordering is deliberate: an unregistered or schema-invalid action is reported before anything else,
because every later check would be reading values that may not mean what they appear to; a missing
capability outranks a missing asset, because the action would not run even with the asset present.

**One function, three surfaces.** The inspector's badge, the timeline clip's dot, and the project
explorer's row all call it with the same inputs — the same registry, the same
`CapabilityRegistry`, the same asset resolver the runtime resolves through. A clip badged
"Missing asset" and an inspector explaining why therefore cannot disagree.

## What an action author gets for free

Declaring a descriptor — and nothing else — yields: a control per parameter, of the right kind,
bounded and defaulted; grouping and conditional visibility if declared; preset buttons if
declared; a status badge everywhere the action appears; validation on every edit using the exact
`resolveParams` the catalog loader uses; and a save/reload round trip through the wire format.

## Enforcement

1. `test/domain/registry-completeness.test.ts` — every parameter has a name, kind, default and a
   non-trivial description; numbers are bounded; enums list their values and contain their own
   default; asset prefixes start with `@`; `visibleWhen` gates on a real enum parameter of the same
   action; every preset sets only real parameters at schema-valid values.
2. `test/adapters/inspector.test.ts` — a **throwaway action type nobody shipped**, registered
   through the production registry, renders correct controls with zero changes to the inspector.
   This is the actual proof of FR-072/SC-002.
3. `test/adapters/action-surfaces.test.ts` — for every shipped action, expectations are *derived
   from its own descriptor*: every declared parameter produces a control, and exactly the
   parameters that apply at the current values are shown. A hand-written list of expected fields
   would only ever confirm that someone remembered to update the list.
4. `test/domain/action-status.test.ts` — each status, its precedence, and a newly registered
   action getting meaningful status with no change to the evaluation.
