"""Publish pose reference imagery as a repository-level shared binary asset.

Mudra Capture ships a reference picture per pose (``apps/capture/assets/poses/*.png``).
Mudra Web wants the same pictures — an author wiring an effect to a pose should see the
hand shape, and so should a visitor reading "which poses work?".

Web must not reach into Capture. The constitution's application-boundary rule is
unambiguous: *"An application MUST NOT import, vendor, or reach into another application's
source"*, and ``apps/web/test/architecture/boundaries.test.ts`` fails the build if any Web
source or test so much as **names** a path inside a sibling application. It must not copy
the images into its own tree either: the shared-binary-asset rule says repository-level
assets under ``assets/`` are shared infrastructure and *"An application MUST NOT copy such
an asset into its own tree"*.

Both rules point at the same answer, and it is the one the MediaPipe models already use:
the canonical copy lives at ``assets/poses/``, and every application reads it from there.
This script is the repository-level step that puts it there — the same role
``export_web_exemplars.py`` plays for the dataset, and run the same way, from the
repository root::

    python scripts/export_pose_images.py

Two things worth stating plainly:

**Why Capture keeps its in-package copy.** Flutter resolves asset paths relative to its own
``pubspec.yaml`` and does not support assets outside the package directory, so Capture
cannot read ``assets/poses/`` the way Vite can. Capture's copy is therefore the *authoring*
location and this script publishes from it; ``assets/poses/`` is what every other
application consumes. Nothing consumes both, so the two cannot drift apart unnoticed in the
way the shared-model rule exists to prevent — and if Capture ever gains the ability to read
outside its package, the copy under ``apps/capture/`` is the one that goes.

**Why the output is not committed.** ``assets/`` holds derived and large binary artifacts
(``hand_landmarker.task``, ``selfie_segmenter.tflite``) and is git-ignored for exactly that
reason. A checkout without this step run simply has no pose imagery, and every consumer is
already required to handle that: Web hides the image and shows the pose's name.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = REPO_ROOT / "apps" / "capture" / "assets" / "poses"
TARGET_DIR = REPO_ROOT / "assets" / "poses"

#: Only image formats a browser can draw. Anything else in the source directory is ignored
#: rather than published, so an unrelated file added there never becomes a served asset.
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".svg"}


def export_pose_images(source_dir: Path = SOURCE_DIR, target_dir: Path = TARGET_DIR) -> int:
    """Copy every pose image from ``source_dir`` to ``target_dir``.

    Existing files are overwritten; files in the target that no longer exist in the source
    are removed, so a pose renamed upstream does not leave a stale picture behind that a
    consumer would go on serving.

    :returns: how many images were published.
    """
    if not source_dir.is_dir():
        raise SystemExit(f"No pose image source directory at {source_dir}.")

    target_dir.mkdir(parents=True, exist_ok=True)

    published: set[str] = set()
    for path in sorted(source_dir.iterdir()):
        if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        shutil.copy2(path, target_dir / path.name)
        published.add(path.name)
        print(f"published {path.name}")

    for path in sorted(target_dir.iterdir()):
        if path.is_file() and path.name not in published:
            path.unlink()
            print(f"removed stale {path.name}")

    print(f"\n{len(published)} pose image(s) published to {target_dir}")
    return len(published)


if __name__ == "__main__":
    sys.exit(0 if export_pose_images() > 0 else 1)
