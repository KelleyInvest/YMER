"""Cost ledger (spec section 11, P0 item 5): one atomically-written record
per job, capturing the estimated/actual cost for later reconciliation
against the P4 settlement lanes."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from evidence._atomic import atomic_write_json
from schema.job import Job


class CostLedger:
    def __init__(self, root: Path) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def record_cost(self, job: Job, provider_id: str, amount: float, currency: str = "EUR") -> Path:
        if amount < 0:
            raise ValueError("cost amount must be non-negative")
        entry = {
            "job_id": job.id,
            "provider_id": provider_id,
            "amount": amount,
            "currency": currency,
        }
        path = self._root / f"{job.id}.json"
        atomic_write_json(path, entry)
        return path

    def get_cost(self, job_id: str) -> dict[str, Any]:
        path = self._root / f"{job_id}.json"
        return json.loads(path.read_bytes())
