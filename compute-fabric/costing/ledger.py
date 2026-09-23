"""Cost ledger (spec section 11, P0 item 5): append-only, atomically written
cost records per job, capturing estimated and actual cost for later
reconciliation against the P4 settlement lanes."""
from __future__ import annotations

import datetime as dt
import json
import uuid
from pathlib import Path
from typing import Any

from evidence._atomic import atomic_write_json
from schema.job import Job, validate_job_id

UTC = dt.timezone.utc


class CostLedger:
    def __init__(self, root: Path) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def record_cost(self, job: Job, provider_id: str, amount: float, currency: str = "EUR") -> Path:
        if amount < 0:
            raise ValueError("cost amount must be non-negative")
        now = dt.datetime.now(UTC)
        entry = {
            "job_id": job.id,
            "provider_id": provider_id,
            "amount": amount,
            "currency": currency,
            "recorded_utc": now.isoformat(),
        }
        name = now.strftime("%Y%m%dT%H%M%S.%fZ") + "-" + uuid.uuid4().hex + ".json"
        path = self._root / job.id / name
        atomic_write_json(path, entry)
        return path

    def history(self, job_id: str) -> list[dict[str, Any]]:
        """Every cost record for a job, oldest first."""
        directory = self._root / validate_job_id(job_id)
        return [json.loads(path.read_bytes()) for path in sorted(directory.glob("*.json"))]

    def get_cost(self, job_id: str) -> dict[str, Any]:
        """The most recent cost record for a job."""
        records = self.history(job_id)
        if not records:
            raise KeyError(f"no cost record for job: {job_id}")
        return records[-1]
