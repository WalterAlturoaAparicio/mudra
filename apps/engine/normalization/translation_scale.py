"""Translation + scale normalization.

Re-origins each hand at the wrist (``origin_index``) and scales uniformly by the
distance from the wrist to a reference landmark (``scale_index``, the middle-finger
MCP by default). This removes where the hand is in frame and how far it is from the
camera while preserving orientation, so the same pose is comparable across position
and distance (research D1). Rotation is deliberately not removed.
"""

from __future__ import annotations

import math

from engine.config.models import NormalizationConfig
from engine.models.landmarks import HandLandmarks, Landmark
from engine.utils.logging import logger

__all__ = ["TranslationScaleNormalizer"]


class TranslationScaleNormalizer:
    """Wrist-origin translation + uniform hand-span scale normalizer."""

    strategy: str = "translation_scale"
    version: str = "1.0"

    def __init__(self, config: NormalizationConfig) -> None:
        """Store the origin/scale landmark indices from configuration."""
        self._origin_index = config.origin_index
        self._scale_index = config.scale_index

    def normalize(self, hand: HandLandmarks) -> HandLandmarks:
        """Return a translated + uniformly scaled copy of ``hand``.

        The wrist becomes the origin; coordinates are divided by the wrist-to-
        reference span. A ~zero span (degenerate/collapsed hand) falls back to a
        scale of 1.0 (translation only) with a warning, rather than dividing by zero.
        """
        origin = hand.points[self._origin_index]
        reference = hand.points[self._scale_index]

        span = math.sqrt(
            (reference.x - origin.x) ** 2
            + (reference.y - origin.y) ** 2
            + (reference.z - origin.z) ** 2
        )
        if span < 1e-9:
            logger.warning(
                "Degenerate hand span ({:.3e}); applying translation only (scale=1.0).", span
            )
            span = 1.0

        normalized = tuple(
            Landmark(
                x=(p.x - origin.x) / span,
                y=(p.y - origin.y) / span,
                z=(p.z - origin.z) / span,
                visibility=p.visibility,
            )
            for p in hand.points
        )
        return HandLandmarks(points=normalized)
