/**
 * The structural match FR-066 defines, and the reason it is not a byte comparison (research D9).
 *
 * Python renders `2.79e-07` where JavaScript renders `2.79e-7` for the same IEEE-754 double. The
 * values are identical; only the text differs. A byte comparison would fail on a non-difference,
 * and the natural "fix" would be a hand-written number formatter — new code, new bugs, no benefit.
 *
 * Exact numeric equality on parsed doubles is the stronger check anyway: it cannot be fooled by
 * matching text that came from a different value.
 *
 * Key **order** is compared, not just the key set, because it is part of the contract and because
 * both `JSON.parse` and `JSON.stringify` preserve insertion order for the non-integer string keys
 * this schema uses.
 */

/** A path-tagged difference, written so a failure names where to look. */
export interface StructuralDifference {
  readonly path: string;
  readonly detail: string;
}

function describe(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (typeof value === 'object') {
    return `object{${Object.keys(value as object).join(',')}}`;
  }
  return `${typeof value} ${JSON.stringify(value)}`;
}

/**
 * Compare two parsed JSON values structurally.
 *
 * @returns every difference found, in document order. Empty means a structural match.
 */
export function structuralDifferences(
  expected: unknown,
  actual: unknown,
  path = '$',
): StructuralDifference[] {
  const differences: StructuralDifference[] = [];

  if (expected === null || actual === null) {
    if (expected !== actual) {
      differences.push({
        path,
        detail: `expected ${describe(expected)}, got ${describe(actual)}`,
      });
    }
    return differences;
  }

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      differences.push({ path, detail: `expected ${describe(expected)}, got ${describe(actual)}` });
      return differences;
    }
    if (expected.length !== actual.length) {
      differences.push({
        path,
        detail: `expected ${expected.length} elements, got ${actual.length}`,
      });
      return differences;
    }
    expected.forEach((element, index) => {
      differences.push(...structuralDifferences(element, actual[index], `${path}[${index}]`));
    });
    return differences;
  }

  if (typeof expected === 'object' || typeof actual === 'object') {
    if (typeof expected !== 'object' || typeof actual !== 'object') {
      differences.push({ path, detail: `expected ${describe(expected)}, got ${describe(actual)}` });
      return differences;
    }
    const expectedKeys = Object.keys(expected as Record<string, unknown>);
    const actualKeys = Object.keys(actual as Record<string, unknown>);

    // Order, not just membership — the contract says key order is part of the match.
    if (
      expectedKeys.length !== actualKeys.length ||
      expectedKeys.some((k, i) => k !== actualKeys[i])
    ) {
      const missing = expectedKeys.filter((k) => !actualKeys.includes(k));
      const extra = actualKeys.filter((k) => !expectedKeys.includes(k));
      const detail =
        missing.length > 0 || extra.length > 0
          ? `key set differs — missing [${missing.join(', ')}], unexpected [${extra.join(', ')}]`
          : `key order differs — expected [${expectedKeys.join(', ')}], got [${actualKeys.join(', ')}]`;
      differences.push({ path, detail });
      return differences;
    }

    for (const key of expectedKeys) {
      differences.push(
        ...structuralDifferences(
          (expected as Record<string, unknown>)[key],
          (actual as Record<string, unknown>)[key],
          `${path}.${key}`,
        ),
      );
    }
    return differences;
  }

  if (typeof expected === 'number' || typeof actual === 'number') {
    if (typeof expected !== 'number' || typeof actual !== 'number') {
      differences.push({ path, detail: `expected ${describe(expected)}, got ${describe(actual)}` });
      return differences;
    }
    // Exact equality as doubles. `Object.is` so `NaN`/`-0` are compared honestly rather than
    // silently passing — neither should ever appear in a sample, and if one does we want to know.
    if (!Object.is(expected, actual)) {
      differences.push({ path, detail: `expected ${expected}, got ${actual}` });
    }
    return differences;
  }

  if (expected !== actual) {
    differences.push({ path, detail: `expected ${describe(expected)}, got ${describe(actual)}` });
  }
  return differences;
}

/** A human-readable report, or `null` when the two match structurally. */
export function structuralMismatch(expected: unknown, actual: unknown): string | null {
  const differences = structuralDifferences(expected, actual);
  if (differences.length === 0) {
    return null;
  }
  return differences.map((d) => `${d.path}: ${d.detail}`).join('\n');
}
