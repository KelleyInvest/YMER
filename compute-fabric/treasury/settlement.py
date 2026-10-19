"""Settlement (spec section 11, P4 item 1).

`SettlementRail` is a port. The only implementation here is `LedgerOnlyRail`,
which records that BASE owes a beneficiary an amount and moves nothing.

**No crypto rail is implemented, deliberately.** Spec P4 names SOL settlement,
and building it is a regulatory decision rather than an integration task: moving
client value makes BASE a payment actor, Norway is in the EEA so MiCA is in
scope, and the treasury reserves that back settlement are themselves regulated
in many jurisdictions. That needs counsel before code, not after.

The port exists so that decision stays a decision. Everything upstream — accrual,
controls, approval, the obligation record — is rail-independent and testable
today, and a future rail implements this interface rather than rewriting the
ledger around itself.
"""
from __future__ import annotations

import abc
import datetime as dt
import json
import uuid
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any

from evidence._atomic import atomic_write_json
from treasury.controls import TreasuryControls
from treasury.rewards import validate_beneficiary_id

UTC = dt.timezone.utc


class ObligationState(str, Enum):
    RECORDED = "recorded"
    SETTLED = "settled"


@dataclass(frozen=True)
class Obligation:
    obligation_id: str
    beneficiary_id: str
    amount: float
    currency: str
    state: ObligationState
    recorded_utc: str
    rail: str
    rail_reference: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "obligation_id": self.obligation_id,
            "beneficiary_id": self.beneficiary_id,
            "amount": self.amount,
            "currency": self.currency,
            "state": self.state.value,
            "recorded_utc": self.recorded_utc,
            "rail": self.rail,
            "rail_reference": self.rail_reference,
        }


class SettlementRail(abc.ABC):
    """A way of actually paying an obligation. Implementations move value and
    are therefore a regulated decision — see the module docstring."""

    rail_id: str

    @abc.abstractmethod
    def pay(self, obligation: Obligation) -> str:
        """Pay the obligation and return the rail's reference for it."""


class LedgerOnlyRail(SettlementRail):
    """Records the obligation as settled in our books without moving value.

    Useful for netting against a client's next invoice, and as the honest
    default while no payment rail is authorised.
    """

    rail_id = "ledger-only"

    def pay(self, obligation: Obligation) -> str:
        return f"ledger:{obligation.obligation_id}"


class SettlementLedger:
    def __init__(self, root: Path, controls: TreasuryControls | None = None) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)
        self._controls = controls or TreasuryControls()

    def record(self, beneficiary_id: str, amount: float, currency: str) -> Obligation:
        """Record what is owed. Recording is not paying."""
        validate_beneficiary_id(beneficiary_id)
        if amount <= 0:
            raise ValueError("obligation amount must be positive")
        if not currency:
            raise ValueError("currency must be set")

        now = dt.datetime.now(UTC)
        obligation = Obligation(
            obligation_id=uuid.uuid4().hex,
            beneficiary_id=beneficiary_id,
            amount=amount,
            currency=currency,
            state=ObligationState.RECORDED,
            recorded_utc=now.isoformat(),
            rail="unassigned",
        )
        self._write(obligation)
        return obligation

    def settle(
        self,
        obligation: Obligation,
        rail: SettlementRail,
        balance: float,
        paid_today: float = 0.0,
        approved: bool = False,
    ) -> Obligation:
        """Pay a recorded obligation over a rail, once the controls allow it."""
        if obligation.state is not ObligationState.RECORDED:
            raise ValueError(f"obligation {obligation.obligation_id} is not awaiting settlement")

        self._controls.check(
            amount=obligation.amount,
            balance=balance,
            paid_today=paid_today,
            approved=approved,
        )

        reference = rail.pay(obligation)
        settled = Obligation(
            obligation_id=obligation.obligation_id,
            beneficiary_id=obligation.beneficiary_id,
            amount=obligation.amount,
            currency=obligation.currency,
            state=ObligationState.SETTLED,
            recorded_utc=obligation.recorded_utc,
            rail=rail.rail_id,
            rail_reference=reference,
        )
        self._write(settled)
        return settled

    def history(self, beneficiary_id: str) -> list[dict[str, Any]]:
        directory = self._root / validate_beneficiary_id(beneficiary_id)
        return [json.loads(path.read_bytes()) for path in sorted(directory.glob("*.json"))]

    def outstanding(self, beneficiary_id: str, currency: str) -> float:
        """What is recorded but not yet settled."""
        states: dict[str, dict[str, Any]] = {}
        for record in self.history(beneficiary_id):
            states[record["obligation_id"]] = record
        return round(
            sum(
                record["amount"]
                for record in states.values()
                if record["state"] == ObligationState.RECORDED.value
                and record["currency"] == currency
            ),
            6,
        )

    def _write(self, obligation: Obligation) -> None:
        # Each state change is its own file, so the trail shows recorded-then-settled
        # rather than a single mutable row.
        now = dt.datetime.now(UTC).strftime("%Y%m%dT%H%M%S.%fZ")
        name = f"{now}-{obligation.obligation_id}-{obligation.state.value}.json"
        atomic_write_json(self._root / obligation.beneficiary_id / name, obligation.to_dict())
