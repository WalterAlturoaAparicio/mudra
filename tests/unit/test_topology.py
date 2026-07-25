"""Tests for the hand landmark topology constants."""

from __future__ import annotations

from engine.models.topology import HAND_CONNECTIONS, HAND_LANDMARK_COUNT, LandmarkIndex


def test_landmark_count_is_21() -> None:
    assert HAND_LANDMARK_COUNT == 21
    assert len(LandmarkIndex) == 21


def test_connection_indices_are_in_range() -> None:
    for start, end in HAND_CONNECTIONS:
        assert 0 <= start < HAND_LANDMARK_COUNT
        assert 0 <= end < HAND_LANDMARK_COUNT


def test_no_self_loops() -> None:
    for start, end in HAND_CONNECTIONS:
        assert start != end


def test_connections_are_unique() -> None:
    normalized = {frozenset((start, end)) for start, end in HAND_CONNECTIONS}
    assert len(normalized) == len(HAND_CONNECTIONS)


def test_every_landmark_is_connected() -> None:
    connected = {idx for pair in HAND_CONNECTIONS for idx in pair}
    assert connected == set(range(HAND_LANDMARK_COUNT))
