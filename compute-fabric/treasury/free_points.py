"""FREE Points (spec section 11, P4 item 2).

FREE Points are an internal loyalty credit: earned through use of BASE and spent
against BASE services. They are deliberately **not** a token.

Three properties keep them that way, and all three are structural rather than
documented:

- No transfer. There is no method to move points between accounts, so points
  cannot circulate or acquire a secondary-market price.
- No cash-out. There is no redemption to money or crypto; points reduce what a
  client owes for BASE services and nothing else.
- No issuance to non-users. Points are minted only against recorded activity.

Those three together are what separate a loyalty balance from a transferable
instrument. Adding any of them is a regulatory decision, not a feature: in the
EEA, issuing a transferable token brings MiCA obligations, and a cash-out path
starts to look like stored value. Tests assert the methods do not exist, so the
decision has to be made deliberately.

FREE Meme (spec P4 item 3) is not implemented here at all, for the same reason.
"""
from __future__ import annotations

import datetime as dt
import json
import uuid
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any

from evidence._atomic import atomic_write_json
from treasury.rewards import validate_beneficiary_id

UTC = dt.timezone.utc


class PointsEntryKind(str, Enum):
    EARNED = "earned"
    SPENT = "spent"
    EXPIRED = "expired"


@dataclass(frozen=True)
class PointsEntry:
    entry_id: str
    account_id: str
    kind: PointsEntryKind
    points: int
    reason: str
    recorded_utc: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "entry_id": self.entry_id,
            "account_id": self.account_id,
            "kind": self.kind.value,
            "points": self.points,
            "reason": self.reason,
            "recorded_utc": self.recorded_utc,
        }


class InsufficientPoints(ValueError):
    pass


class FreePointsLedger:
    """Append-only points ledger.

    Deliberately absent, and to stay absent without an explicit decision:
    `transfer`, `redeem_for_cash`, `withdraw`, `convert_to_token`.
    """

    def __init__(self, root: Path) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def earn(self, account_id: str, points: int, reason: str) -> PointsEntry:
        if not reason:
            raise ValueError("earning points requires a recorded reason")
        return self._record(account_id, PointsEntryKind.EARNED, points, reason)

    def spend(self, account_id: str, points: int, reason: str) -> PointsEntry:
        """Spend points against BASE services. There is no other way out."""
        if not reason:
            raise ValueError("spending points requires a recorded reason")
        if points > self.balance(account_id):
            raise InsufficientPoints(
                f"{account_id} has {self.balance(account_id)} points, cannot spend {points}"
            )
        return self._record(account_id, PointsEntryKind.SPENT, points, reason)

    def expire(self, account_id: str, points: int, reason: str = "expiry") -> PointsEntry:
        if points > self.balance(account_id):
            raise InsufficientPoints("cannot expire more points than the account holds")
        return self._record(account_id, PointsEntryKind.EXPIRED, points, reason)

    def balance(self, account_id: str) -> int:
        total = 0
        for record in self.history(account_id):
            if record["kind"] == PointsEntryKind.EARNED.value:
                total += record["points"]
            else:
                total -= record["points"]
        return total

    def history(self, account_id: str) -> list[dict[str, Any]]:
        directory = self._root / validate_beneficiary_id(account_id)
        return [json.loads(path.read_bytes()) for path in sorted(directory.glob("*.json"))]

    def _record(
        self, account_id: str, kind: PointsEntryKind, points: int, reason: str
    ) -> PointsEntry:
        validate_beneficiary_id(account_id)
        if not isinstance(points, int) or isinstance(points, bool) or points <= 0:
            raise ValueError("points must be a positive int")

        now = dt.datetime.now(UTC)
        entry = PointsEntry(
            entry_id=uuid.uuid4().hex,
            account_id=account_id,
            kind=kind,
            points=points,
            reason=reason,
            recorded_utc=now.isoformat(),
        )
        name = now.strftime("%Y%m%dT%H%M%S.%fZ") + "-" + entry.entry_id + ".json"
        atomic_write_json(self._root / account_id / name, entry.to_dict())
        return entry
