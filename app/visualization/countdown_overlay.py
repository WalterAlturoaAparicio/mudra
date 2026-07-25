"""OpenCV countdown overlay.

Draws the large "Recording pose in / 3 / q-Esc to cancel" overlay over the *live*
feed while a countdown runs, using only OpenCV primitives and the neutral
:class:`~app.models.countdown.CountdownTick` — it knows nothing about pose
recording, so any future countdown workflow reuses it unchanged (constitution
Principle I). Sizes and colors come from configuration (Principle V).
"""

from __future__ import annotations

import cv2

from app.camera.source import Frame
from app.config.models import VisualizationConfig
from app.models.countdown import CountdownTick
from app.visualization.renderer import CountdownRenderer

__all__ = ["CountdownOverlayRenderer"]

_FONT = cv2.FONT_HERSHEY_SIMPLEX
_DIGIT_THICKNESS_RATIO = 8  # digit stroke thickness relative to its font scale


class CountdownOverlayRenderer(CountdownRenderer):
    """Renders a dimmed backdrop, a caption, the remaining seconds, and a hint."""

    def __init__(self, config: VisualizationConfig) -> None:
        """Store overlay configuration (colors, prompt/hint text, sizes)."""
        self._config = config

    def render_countdown(self, frame: Frame, tick: CountdownTick) -> Frame:
        """Draw the countdown for ``tick`` onto ``frame`` in place and return it."""
        height, width = frame.shape[:2]
        self._dim(frame)

        digit = str(tick.display_value)
        scale = self._digit_font_scale(height)
        thickness = max(int(scale * _DIGIT_THICKNESS_RATIO), 2)
        (digit_w, digit_h), _ = cv2.getTextSize(digit, _FONT, scale, thickness)
        digit_origin = ((width - digit_w) // 2, (height + digit_h) // 2)

        self._centered_text(
            frame, self._config.countdown_prompt, width, digit_origin[1] - digit_h - 24, 1.0, 2
        )
        cv2.putText(
            frame,
            digit,
            digit_origin,
            _FONT,
            scale,
            self._config.countdown_color,
            thickness,
            cv2.LINE_AA,
        )
        self._centered_text(frame, self._config.countdown_hint, width, digit_origin[1] + 44, 0.7, 2)
        return frame

    # -- helpers -----------------------------------------------------------------

    def _digit_font_scale(self, height: int) -> float:
        """Font scale making the digit ``countdown_digit_scale`` of the frame height."""
        # A HERSHEY_SIMPLEX digit is ~22 px tall at scale 1.0.
        return max(height * self._config.countdown_digit_scale / 22.0, 1.0)

    def _dim(self, frame: Frame) -> None:
        """Darken the frame in place so the countdown stays legible over any scene."""
        factor = 1.0 - self._config.countdown_dim
        if factor >= 1.0:
            return
        cv2.convertScaleAbs(frame, frame, factor, 0)

    def _centered_text(
        self, frame: Frame, text: str, width: int, y: int, scale: float, thickness: int
    ) -> None:
        """Draw ``text`` horizontally centered with its baseline at ``y``."""
        if not text:
            return
        (text_w, _), _ = cv2.getTextSize(text, _FONT, scale, thickness)
        cv2.putText(
            frame,
            text,
            ((width - text_w) // 2, max(y, 0)),
            _FONT,
            scale,
            self._config.countdown_color,
            thickness,
            cv2.LINE_AA,
        )
