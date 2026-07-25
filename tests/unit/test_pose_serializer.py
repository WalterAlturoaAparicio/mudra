"""Tests for the pose sample serializer and JSON schema."""

from __future__ import annotations

import dataclasses
import json

import pytest
from engine.dataset.serializer import SCHEMA_VERSION, PoseSchemaError, PoseSerializer
from engine.models.pose import CaptureTiming

from tests.unit.factories import make_pose_sample


def _sample_with_capture() -> object:
    sample = make_pose_sample()
    metadata = dataclasses.replace(
        sample.metadata,
        capture=CaptureTiming(
            capture_time="2026-07-24T13:20:00+00:00",
            countdown_start_time="2026-07-24T13:19:57+00:00",
            countdown_seconds=3.0,
        ),
    )
    return dataclasses.replace(sample, metadata=metadata)


def test_round_trip_equal() -> None:
    serializer = PoseSerializer()
    sample = make_pose_sample()
    assert serializer.from_dict(serializer.to_dict(sample)) == sample


def test_json_round_trip_equal() -> None:
    serializer = PoseSerializer()
    sample = make_pose_sample()
    assert serializer.from_json(serializer.to_json(sample)) == sample


def test_field_order_and_schema_version() -> None:
    data = PoseSerializer().to_dict(make_pose_sample())
    assert data["schema_version"] == SCHEMA_VERSION
    assert list(data.keys()) == [
        "schema_version",
        "pose_id",
        "display_name",
        "description",
        "sample_uuid",
        "sample_number",
        "timestamp",
        "normalization",
        "metadata",
        "hands",
    ]


def test_uuid_number_and_normalization_present() -> None:
    data = PoseSerializer().to_dict(make_pose_sample())
    assert data["sample_uuid"] == "550e8400-e29b-41d4-a716-446655440000"
    assert data["sample_number"] == "sample_000001"
    assert data["normalization"] == {"strategy": "translation_scale", "version": "1.0"}


def test_hands_have_raw_and_normalized_21() -> None:
    hand = PoseSerializer().to_dict(make_pose_sample())["hands"][0]
    assert len(hand["raw"]) == 21
    assert len(hand["normalized"]) == 21


def test_indented_output() -> None:
    text = PoseSerializer().to_json(make_pose_sample(), indent=2)
    assert "\n  " in text  # human-readable, indented


def test_wrong_schema_version_raises() -> None:
    serializer = PoseSerializer()
    data = serializer.to_dict(make_pose_sample())
    data["schema_version"] = 999
    with pytest.raises(PoseSchemaError):
        serializer.from_dict(data)


def test_malformed_document_raises() -> None:
    serializer = PoseSerializer()
    data = serializer.to_dict(make_pose_sample())
    del data["hands"]
    with pytest.raises(PoseSchemaError):
        serializer.from_dict(data)


def test_bad_landmark_count_raises() -> None:
    serializer = PoseSerializer()
    data = serializer.to_dict(make_pose_sample())
    data["hands"][0]["raw"] = data["hands"][0]["raw"][:20]
    with pytest.raises(PoseSchemaError):
        serializer.from_dict(data)


def test_invalid_json_raises() -> None:
    with pytest.raises(PoseSchemaError):
        PoseSerializer().from_json("{not valid json")


def test_capture_timing_round_trips() -> None:
    serializer = PoseSerializer()
    sample = _sample_with_capture()
    assert serializer.from_json(serializer.to_json(sample)) == sample


def test_capture_timing_fields_are_written() -> None:
    capture = PoseSerializer().to_dict(_sample_with_capture())["metadata"]["capture"]
    assert capture == {
        "countdown_start_time": "2026-07-24T13:19:57+00:00",
        "capture_time": "2026-07-24T13:20:00+00:00",
        "countdown_seconds": 3.0,
    }


def test_capture_is_null_without_a_countdown() -> None:
    assert PoseSerializer().to_dict(make_pose_sample())["metadata"]["capture"] is None


def test_documents_without_capture_still_load() -> None:
    serializer = PoseSerializer()
    data = serializer.to_dict(make_pose_sample())
    del data["metadata"]["capture"]  # written before the countdown existed
    assert serializer.from_dict(data).metadata.capture is None


def test_output_parses_as_json() -> None:
    text = PoseSerializer().to_json(make_pose_sample())
    json.loads(text)  # must not raise
