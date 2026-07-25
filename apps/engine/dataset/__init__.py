"""Dataset persistence: the ``PoseRepository`` abstraction and JSON serialization.

The storage medium sits behind ``PoseRepository`` so it can be replaced (SQLite,
Postgres, cloud) without changing recording or validation behaviour.
"""
