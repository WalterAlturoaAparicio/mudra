"""Tests for the translation + scale normalizer."""

from __future__ import annotations

import math

import pytest
from app.config.models import NormalizationConfig
from app.models.landmarks import HandLandmarks, Landmark
from app.normalization.translation_scale import TranslationScaleNormalizer

from tests.unit.factories import make_hand_landmarks


def _normalizer() -> TranslationScaleNormalizer:
    return TranslationScaleNormalizer(NormalizationConfig())


def test_strategy_and_version() -> None:
    n = _normalizer()
    assert n.strategy == "translation_scale"
    assert n.version == "1.0"


def test_wrist_maps_to_origin() -> None:
    result = _normalizer().normalize(make_hand_landmarks())
    wrist = result.points[0]
    assert wrist.x == pytest.approx(0.0)
    assert wrist.y == pytest.approx(0.0)
    assert wrist.z == pytest.approx(0.0)


def test_translation_invariance() -> None:
    n = _normalizer()
    base = n.normalize(make_hand_landmarks(offset=0.0))
    shifted = n.normalize(make_hand_landmarks(offset=0.3))
    for a, b in zip(base.points, shifted.points, strict=True):
        assert a.x == pytest.approx(b.x)
        assert a.y == pytest.approx(b.y)
        assert a.z == pytest.approx(b.z)


def test_scale_invariance() -> None:
    n = _normalizer()
    base = n.normalize(make_hand_landmarks(scale=1.0))
    bigger = n.normalize(make_hand_landmarks(scale=2.5))
    for a, b in zip(base.points, bigger.points, strict=True):
        assert a.x == pytest.approx(b.x)
        assert a.y == pytest.approx(b.y)
        assert a.z == pytest.approx(b.z)


def test_reference_landmark_has_unit_span() -> None:
    # After normalization, distance wrist->scale_index should be 1.0.
    result = _normalizer().normalize(make_hand_landmarks())
    ref = result.points[9]
    span = math.sqrt(ref.x**2 + ref.y**2 + ref.z**2)
    assert span == pytest.approx(1.0)


def test_degenerate_span_does_not_raise() -> None:
    collapsed = HandLandmarks(points=tuple(Landmark(x=0.5, y=0.5, z=0.0) for _ in range(21)))
    result = _normalizer().normalize(collapsed)
    # All points coincide with the wrist → all zeros, no division error.
    assert all(p.x == pytest.approx(0.0) for p in result.points)


def test_input_not_mutated() -> None:
    original = make_hand_landmarks()
    _normalizer().normalize(original)
    assert original.points[5].x == pytest.approx(0.05)
