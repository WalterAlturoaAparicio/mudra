"""FR-086 as an executable assertion, not a review habit.

Hash every file under ``datasets/poses/``, run the real export over it, hash again, and
require byte-for-byte equality. This follows the ``tests/studio/test_read_only.py``
precedent deliberately: read-only guarantees erode quietly as an application grows, and
the only claim worth making is about the **actual dataset on disk**, not about the export
code's intentions.

The real tree is only ever *read* here — the assertion is precisely that nothing changed,
so a failure of this test is also its own evidence that the dataset was touched.
"""

from __future__ import annotations

import ast
import hashlib
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
DATASET = REPO_ROOT / "datasets"
REAL_POSES = DATASET / "poses"
EXPORT_SCRIPT = REPO_ROOT / "scripts" / "export_web_exemplars.py"
FIXTURE_SCRIPT = REPO_ROOT / "scripts" / "export_web_fixtures.py"


def hash_tree(root: Path) -> dict[str, str]:
    """Map every file under ``root`` to a SHA-256 of its bytes."""
    digests: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            digests[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return digests


@pytest.mark.skipif(not REAL_POSES.is_dir(), reason="repository dataset not present")
def test_the_export_leaves_the_real_dataset_byte_identical(tmp_path: Path) -> None:
    """The export writes into ``--out-dir`` and nowhere else."""
    before = hash_tree(REAL_POSES)
    assert before, "the repository dataset should not be empty"

    result = subprocess.run(
        [
            sys.executable,
            str(EXPORT_SCRIPT),
            "--dataset-root",
            str(DATASET),
            "--out-dir",
            str(tmp_path / "out"),
        ],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr

    after = hash_tree(REAL_POSES)
    assert set(before) == set(after), "no dataset file was created or removed"
    assert before == after, "no dataset file's contents changed"

    # And it actually did the work — a no-op export would pass the assertions above.
    assert (tmp_path / "out" / "exemplars.bin").stat().st_size > 0
    assert "Included" in result.stdout


@pytest.mark.skipif(not REAL_POSES.is_dir(), reason="repository dataset not present")
def test_generating_the_golden_fixtures_leaves_the_dataset_byte_identical() -> None:
    """The matcher fixtures read recorded samples too, and are held to the same rule."""
    before = hash_tree(REAL_POSES)

    result = subprocess.run(
        [sys.executable, str(FIXTURE_SCRIPT)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr

    assert hash_tree(REAL_POSES) == before


def test_the_export_scripts_never_call_engines_write_methods() -> None:
    """Enforcement level 2: the calls are absent, not merely unused.

    Parsed with ``ast`` rather than grepped, so a docstring that *names* a prohibited
    method — contracts/engine-consumption.md lists them precisely to explain why they are
    prohibited — is not mistaken for a call to it.
    """
    forbidden = {"save", "save_all", "saveAll", "next_sample_number", "write_text", "write_bytes"}
    allowed_write_targets = {"manifest_path", "payload_path", "path"}
    offenders: list[str] = []

    for script in (EXPORT_SCRIPT, FIXTURE_SCRIPT):
        tree = ast.parse(script.read_text(encoding="utf-8"), filename=str(script))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
                continue
            if node.func.attr not in forbidden:
                continue
            # The scripts do write their own *output* files; that is the whole point. What
            # must never happen is a write reached through Engine's repository.
            target = node.func.value
            if isinstance(target, ast.Name) and target.id in allowed_write_targets:
                continue
            offenders.append(f"{script.name}:{node.lineno} calls .{node.func.attr}()")

    assert not offenders, "export scripts must not write through Engine: " + "; ".join(offenders)
