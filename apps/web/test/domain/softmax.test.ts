import { describe, expect, it } from 'vitest';

import { softmaxConfidence } from '../../src/domain/recognition/softmax';

describe('softmaxConfidence', () => {
  it('returns nothing for no candidates', () => {
    expect(softmaxConfidence([], 8)).toEqual([]);
  });

  it('gives a single candidate all of the confidence', () => {
    expect(softmaxConfidence([42], 8)).toEqual([1]);
  });

  it('sums to one', () => {
    const confidences = softmaxConfidence([0.5, 12, 30, 41], 8);
    expect(confidences.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('ranks the nearest candidate highest', () => {
    const confidences = softmaxConfidence([30, 0.5, 12], 8);
    expect(confidences[1]).toBeGreaterThan(confidences[2]!);
    expect(confidences[2]).toBeGreaterThan(confidences[0]!);
  });

  it('splits equal distances equally', () => {
    const confidences = softmaxConfidence([7, 7, 7], 8);
    for (const value of confidences) {
      expect(value).toBeCloseTo(1 / 3, 12);
    }
  });

  it('survives distances large enough to underflow without max-subtraction', () => {
    // exp(-4000/0.5) is 0 in float64. An implementation that skipped the max-subtraction
    // would divide 0 by 0 here and hand every downstream gate a NaN.
    const confidences = softmaxConfidence([4000, 4200, 9000], 0.5);
    for (const value of confidences) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(confidences[0]).toBeCloseTo(1, 6);
    expect(confidences.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('flattens as the temperature rises and sharpens as it falls', () => {
    const sharp = softmaxConfidence([1, 3], 0.5);
    const flat = softmaxConfidence([1, 3], 50);
    expect(sharp[0]).toBeGreaterThan(flat[0]!);
    expect(flat[0]).toBeGreaterThan(0.5);
    expect(flat[0]).toBeLessThan(0.55);
  });

  it('rejects a non-positive temperature rather than returning NaN', () => {
    expect(() => softmaxConfidence([1, 2], 0)).toThrow(RangeError);
    expect(() => softmaxConfidence([1, 2], -1)).toThrow(RangeError);
  });

  it('preserves input order', () => {
    const confidences = softmaxConfidence([50, 1, 25], 8);
    expect(confidences).toHaveLength(3);
    expect(confidences[1]).toBe(Math.max(...confidences));
  });
});
