"""Pose sample serialization.

`PoseSerializer` owns the on-disk JSON schema (`contracts/json-schema.md`): the
`SCHEMA_VERSION`, field ordering, indentation, and load-time validation. It maps the
domain `PoseSample` to/from plain ordered dicts and JSON text, holding no filesystem
logic — that belongs to the repository (constitution Principle I; research D3).
"""

from __future__ import annotations

import json
from typing import Any

from app.models.landmarks import Handedness, HandLandmarks, Landmark
from app.models.pose import (
    CaptureTiming,
    HandMeta,
    HandSample,
    NormalizationInfo,
    Pose,
    PoseMetadata,
    PoseSample,
)
from app.models.topology import HAND_LANDMARK_COUNT

__all__ = ["SCHEMA_VERSION", "PoseSerializer", "PoseSchemaError"]

#: Current on-disk schema version.
SCHEMA_VERSION: int = 1


class PoseSchemaError(ValueError):
    """Raised when a document is missing fields, malformed, or an incompatible version."""


class PoseSerializer:
    """Maps `PoseSample` ⇆ ordered dict / JSON text for the versioned schema."""

    def to_dict(self, sample: PoseSample) -> dict[str, Any]:
        """Serialize a sample to an ordered, schema-versioned dict."""
        return {
            "schema_version": SCHEMA_VERSION,
            "pose_id": sample.pose.pose_id,
            "display_name": sample.pose.display_name,
            "description": sample.pose.description,
            "sample_uuid": sample.sample_uuid,
            "sample_number": sample.sample_number,
            "timestamp": sample.timestamp,
            "normalization": {
                "strategy": sample.normalization.strategy,
                "version": sample.normalization.version,
            },
            "metadata": self._metadata_to_dict(sample.metadata),
            "hands": [self._hand_to_dict(hand) for hand in sample.hands],
        }

    def to_json(self, sample: PoseSample, *, indent: int = 2) -> str:
        """Serialize a sample to indented, human-readable JSON text."""
        return json.dumps(self.to_dict(sample), indent=indent, ensure_ascii=False)

    def from_dict(self, data: dict[str, Any]) -> PoseSample:
        """Reconstruct a `PoseSample`, validating the schema and shape."""
        version = data.get("schema_version")
        if version != SCHEMA_VERSION:
            raise PoseSchemaError(
                f"Unsupported schema_version {version!r} (expected {SCHEMA_VERSION})."
            )
        try:
            pose = Pose(
                pose_id=data["pose_id"],
                display_name=data.get("display_name"),
                description=data.get("description"),
            )
            normalization = NormalizationInfo(
                strategy=data["normalization"]["strategy"],
                version=data["normalization"]["version"],
            )
            metadata = self._metadata_from_dict(data["metadata"])
            hands = tuple(self._hand_from_dict(h) for h in data["hands"])
            return PoseSample(
                schema_version=SCHEMA_VERSION,
                pose=pose,
                sample_uuid=data["sample_uuid"],
                sample_number=data.get("sample_number", ""),
                timestamp=data["timestamp"],
                normalization=normalization,
                metadata=metadata,
                hands=hands,
            )
        except (KeyError, TypeError, ValueError) as error:
            raise PoseSchemaError(f"Malformed pose sample document: {error}") from error

    def from_json(self, text: str) -> PoseSample:
        """Reconstruct a `PoseSample` from JSON text."""
        try:
            data = json.loads(text)
        except json.JSONDecodeError as error:
            raise PoseSchemaError(f"Invalid JSON: {error}") from error
        return self.from_dict(data)

    # -- helpers -----------------------------------------------------------------

    @staticmethod
    def _metadata_to_dict(metadata: PoseMetadata) -> dict[str, Any]:
        return {
            "timestamp": metadata.timestamp,
            "camera": {
                "index": metadata.camera_index,
                "width": metadata.camera_width,
                "height": metadata.camera_height,
            },
            "versions": {
                "application": metadata.application_version,
                "mediapipe": metadata.mediapipe_version,
            },
            "num_hands": metadata.num_hands,
            "hands": [
                {"handedness": h.handedness.value, "confidence": h.confidence}
                for h in metadata.hands
            ],
            "capture": PoseSerializer._capture_to_dict(metadata.capture),
        }

    @staticmethod
    def _capture_to_dict(capture: CaptureTiming | None) -> dict[str, Any] | None:
        """Serialize the optional capture-timing block (``null`` when absent)."""
        if capture is None:
            return None
        return {
            "countdown_start_time": capture.countdown_start_time,
            "capture_time": capture.capture_time,
            "countdown_seconds": capture.countdown_seconds,
        }

    @staticmethod
    def _capture_from_dict(data: dict[str, Any] | None) -> CaptureTiming | None:
        """Rebuild the capture-timing block; ``None`` for pre-countdown samples."""
        if not data:
            return None
        return CaptureTiming(
            capture_time=data["capture_time"],
            countdown_start_time=data.get("countdown_start_time"),
            countdown_seconds=data.get("countdown_seconds", 0.0),
        )

    @staticmethod
    def _metadata_from_dict(data: dict[str, Any]) -> PoseMetadata:
        camera = data["camera"]
        versions = data["versions"]
        return PoseMetadata(
            timestamp=data["timestamp"],
            camera_index=camera["index"],
            camera_width=camera["width"],
            camera_height=camera["height"],
            mediapipe_version=versions.get("mediapipe"),
            application_version=versions["application"],
            num_hands=data["num_hands"],
            hands=tuple(
                HandMeta(
                    handedness=Handedness.from_label(h["handedness"]),
                    confidence=h["confidence"],
                )
                for h in data["hands"]
            ),
            capture=PoseSerializer._capture_from_dict(data.get("capture")),
        )

    @staticmethod
    def _hand_to_dict(hand: HandSample) -> dict[str, Any]:
        return {
            "handedness": hand.handedness.value,
            "confidence": hand.confidence,
            "raw": [{"x": p.x, "y": p.y, "z": p.z} for p in hand.raw.points],
            "normalized": [{"x": p.x, "y": p.y, "z": p.z} for p in hand.normalized.points],
        }

    @staticmethod
    def _landmarks_from_list(items: list[dict[str, Any]]) -> HandLandmarks:
        if len(items) != HAND_LANDMARK_COUNT:
            raise PoseSchemaError(f"Expected {HAND_LANDMARK_COUNT} landmarks, got {len(items)}.")
        return HandLandmarks(points=tuple(Landmark(x=p["x"], y=p["y"], z=p["z"]) for p in items))

    def _hand_from_dict(self, data: dict[str, Any]) -> HandSample:
        return HandSample(
            handedness=Handedness.from_label(data["handedness"]),
            confidence=data["confidence"],
            raw=self._landmarks_from_list(data["raw"]),
            normalized=self._landmarks_from_list(data["normalized"]),
        )
