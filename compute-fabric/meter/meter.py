"""Meter (spec section 11, P0 item 6): append-only record of actual resource
usage per job, so cost and capacity accounting can be based on measured, not
just estimated, consumption."""
from __future__ import annotations

import datetime as dt
import json
import uuid
from pathlib import Path
from typing import Any

from evidence._atomic import atomic_write_json
from schema.compute_unit import ComputeUnit
from schema.job import validate_job_id

UTC = dt.timezone.utc


class Meter:
    def __init__(self, root: Path) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def record_usage(self, job_id: str, usage: ComputeUnit, duration_seconds: float) -> Path:
        validate_job_id(job_id)
        if duration_seconds < 0:
            raise ValueError("duration_seconds must be non-negative")
        now = dt.datetime.now(UTC)
        entry = {
            "job_id": job_id,
            "usage": usage.to_dict(),
            "duration_seconds": duration_seconds,
            "recorded_utc": now.isoformat(),
        }
        name = now.strftime("%Y%m%dT%H%M%S.%fZ") + "-" + uuid.uuid4().hex + ".json"
        path = self._root / job_id / name
        atomic_write_json(path, entry)
        return path

    def history(self, job_id: str) -> list[dict[str, Any]]:
        """Every usage record for a job, oldest first."""
        directory = self._root / validate_job_id(job_id)
        return [json.loads(path.read_bytes()) for path in sorted(directory.glob("*.json"))]

    def get_usage(self, job_id: str) -> dict[str, Any]:
        """The most recent usage record for a job."""
        records = self.history(job_id)
        if not records:
            raise KeyError(f"no usage record for job: {job_id}")
        return records[-1]
