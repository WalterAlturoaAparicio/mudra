"""OpenCV overlay renderer.

Draws the 21-point landmark overlay, the skeleton (from ``HAND_CONNECTIONS``),
and the HUD (FPS plus per-hand handedness and classification confidence) using
only OpenCV primitives over the neutral data model — no MediaPipe types
(constitution Principle I, research D2).
"""

from __future__ import annotations

import cv2

from app.camera.source import Frame
from app.config.models import VisualizationConfig
from app.models.landmarks import FrameDetection, HandDetection
from app.models.topology import HAND_CONNECTIONS
from app.visualization.renderer import FrameRenderer

__all__ = ["OpenCVOverlayRenderer"]

_FONT = cv2.FONT_HERSHEY_SIMPLEX


class OpenCVOverlayRenderer(FrameRenderer):
    """Renders landmarks, skeleton, and HUD onto BGR frames."""

    def __init__(self, config: VisualizationConfig) -> None:
        """Store rendering configuration (colors, sizes, toggles)."""
        self._config = config

    def render(self, frame: Frame, detection: FrameDetection, fps: float) -> Frame:
        """Draw the overlay and HUD onto ``frame`` in place and return it."""
        for hand in detection.hands:
            self._draw_hand(frame, hand, detection.frame_width, detection.frame_height)

        if self._config.show_fps:
            self._draw_fps(frame, fps)

        return frame

    def _draw_hand(self, frame: Frame, hand: HandDetection, width: int, height: int) -> None:
        """Draw one hand's skeleton, landmark points, and optional label."""
        points = hand.landmarks.points
        pixels = [p.to_pixel(width, height) for p in points]

        for start, end in HAND_CONNECTIONS:
            cv2.line(
                frame,
                pixels[start],
                pixels[end],
                self._config.connection_color,
                self._config.connection_thickness,
                lineType=cv2.LINE_AA,
            )

        for pixel in pixels:
            cv2.circle(
                frame,
                pixel,
                self._config.landmark_radius,
                self._config.landmark_color,
                thickness=-1,
                lineType=cv2.LINE_AA,
            )

        if self._config.show_handedness:
            self._draw_hand_label(frame, hand, pixels[0])

    def _draw_hand_label(self, frame: Frame, hand: HandDetection, anchor: tuple[int, int]) -> None:
        """Draw ``<Handedness> <score>`` (e.g. ``Left 0.98``) near the wrist."""
        label = f"{hand.handedness.value.capitalize()} {hand.confidence_label}"
        x, y = anchor
        cv2.putText(
            frame,
            label,
            (x, max(y - 10, 12)),
            _FONT,
            0.6,
            self._config.hud_color,
            2,
            lineType=cv2.LINE_AA,
        )

    def _draw_fps(self, frame: Frame, fps: float) -> None:
        """Draw the FPS readout in the top-left corner."""
        cv2.putText(
            frame,
            f"FPS: {fps:5.1f}",
            (10, 30),
            _FONT,
            0.7,
            self._config.hud_color,
            2,
            lineType=cv2.LINE_AA,
        )
