"""Meter (spec section 11, P0 item 6): records actual resource usage per
job so cost and capacity accounting can be based on measured, not just
estimated, consumption."""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

from evidence._atomic import atomic_write_json
from schema.compute_unit import ComputeUnit

UTC = dt.timezone.utc


class Meter:
    def __init__(self, root: Path) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def record_usage(self, job_id: str, usage: ComputeUnit, duration_seconds: float) -> Path:
        if duration_seconds < 0:
            raise ValueError("duration_seconds must be non-negative")
        entry = {
            "job_id": job_id,
            "usage": usage.to_dict(),
            "duration_seconds": duration_seconds,
            "recorded_utc": dt.datetime.now(UTC).isoformat(),
        }
        path = self._root / f"{job_id}.json"
        atomic_write_json(path, entry)
        return path

    def get_usage(self, job_id: str) -> dict[str, Any]:
        path = self._root / f"{job_id}.json"
        return json.loads(path.read_bytes())
