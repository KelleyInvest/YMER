"""Crash-safe write-then-rename helper, shared by the evidence, cost, and
meter ledgers. Mirrors the atomic() pattern used by the BASE RAM read-only
status receiver: write to a temp file in the same directory, fsync it,
os.replace over the destination, then fsync the directory entry."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def atomic_write_json(path: Path, data: Any) -> None:
    encoded = (json.dumps(data, sort_keys=True, indent=2) + "\n").encode()
    atomic_write_bytes(path, encoded)
