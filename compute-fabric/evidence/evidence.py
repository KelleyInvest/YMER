"""Evidence ledger (spec section 11, P0 item 7): append-only, atomically
written record of fabric events (job submitted, cost recorded, meter
reading, ...), for later audit."""
from __future__ import annotations

import datetime as dt
import json
import uuid
from pathlib import Path
from typing import Any

from evidence._atomic import atomic_write_json

UTC = dt.timezone.utc


class EvidenceLedger:
    def __init__(self, root: Path) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def record(self, kind: str, payload: dict[str, Any]) -> Path:
        now = dt.datetime.now(UTC)
        entry = {
            "kind": kind,
            "recorded_utc": now.isoformat(),
            "payload": payload,
        }
        name = now.strftime("%Y%m%dT%H%M%S.%fZ") + "-" + uuid.uuid4().hex + ".json"
        path = self._root / name
        atomic_write_json(path, entry)
        return path

    def all_events(self) -> list[dict[str, Any]]:
        return [
            json.loads(path.read_bytes())
            for path in sorted(self._root.glob("*.json"))
        ]
