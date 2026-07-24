"""Hand landmark topology constants.

Defines the fixed 21-point hand model and the skeleton edges used for drawing,
independent of any detection backend (constitution Principle I). Centralizing
these removes magic numbers from the renderer (Principle IV).
"""

from __future__ import annotations

from enum import IntEnum

__all__ = ["HAND_LANDMARK_COUNT", "LandmarkIndex", "HAND_CONNECTIONS"]

#: The fixed number of landmarks per hand.
HAND_LANDMARK_COUNT: int = 21


class LandmarkIndex(IntEnum):
    """Named indices for the 21 hand landmarks (MediaPipe Hands ordering)."""

    WRIST = 0
    THUMB_CMC = 1
    THUMB_MCP = 2
    THUMB_IP = 3
    THUMB_TIP = 4
    INDEX_MCP = 5
    INDEX_PIP = 6
    INDEX_DIP = 7
    INDEX_TIP = 8
    MIDDLE_MCP = 9
    MIDDLE_PIP = 10
    MIDDLE_DIP = 11
    MIDDLE_TIP = 12
    RING_MCP = 13
    RING_PIP = 14
    RING_DIP = 15
    RING_TIP = 16
    PINKY_MCP = 17
    PINKY_PIP = 18
    PINKY_DIP = 19
    PINKY_TIP = 20


#: Edges of the hand skeleton as ``(start_index, end_index)`` pairs.
HAND_CONNECTIONS: tuple[tuple[int, int], ...] = (
    # Thumb
    (LandmarkIndex.WRIST, LandmarkIndex.THUMB_CMC),
    (LandmarkIndex.THUMB_CMC, LandmarkIndex.THUMB_MCP),
    (LandmarkIndex.THUMB_MCP, LandmarkIndex.THUMB_IP),
    (LandmarkIndex.THUMB_IP, LandmarkIndex.THUMB_TIP),
    # Index finger
    (LandmarkIndex.WRIST, LandmarkIndex.INDEX_MCP),
    (LandmarkIndex.INDEX_MCP, LandmarkIndex.INDEX_PIP),
    (LandmarkIndex.INDEX_PIP, LandmarkIndex.INDEX_DIP),
    (LandmarkIndex.INDEX_DIP, LandmarkIndex.INDEX_TIP),
    # Middle finger
    (LandmarkIndex.MIDDLE_MCP, LandmarkIndex.MIDDLE_PIP),
    (LandmarkIndex.MIDDLE_PIP, LandmarkIndex.MIDDLE_DIP),
    (LandmarkIndex.MIDDLE_DIP, LandmarkIndex.MIDDLE_TIP),
    # Ring finger
    (LandmarkIndex.RING_MCP, LandmarkIndex.RING_PIP),
    (LandmarkIndex.RING_PIP, LandmarkIndex.RING_DIP),
    (LandmarkIndex.RING_DIP, LandmarkIndex.RING_TIP),
    # Pinky
    (LandmarkIndex.WRIST, LandmarkIndex.PINKY_MCP),
    (LandmarkIndex.PINKY_MCP, LandmarkIndex.PINKY_PIP),
    (LandmarkIndex.PINKY_PIP, LandmarkIndex.PINKY_DIP),
    (LandmarkIndex.PINKY_DIP, LandmarkIndex.PINKY_TIP),
    # Palm
    (LandmarkIndex.INDEX_MCP, LandmarkIndex.MIDDLE_MCP),
    (LandmarkIndex.MIDDLE_MCP, LandmarkIndex.RING_MCP),
    (LandmarkIndex.RING_MCP, LandmarkIndex.PINKY_MCP),
)
