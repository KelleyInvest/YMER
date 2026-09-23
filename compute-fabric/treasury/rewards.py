"""Supplier and referral reward accrual (spec section 11, P4 items 4-5).

Spec section 8 puts a supplier share in the client price and says it should be a
policy variable rather than hard-coded accounting. `PricingPolicy` already holds
the rate; this records what that rate accrued, per settled job, append-only.

This ledger records obligations. It does not move value: paying an accrual out
is a treasury action behind `TreasuryControls`, over whatever settlement rail is
eventually chosen. Keeping accrual and payment separate means the books still
balance if a payment fails, and means switching rails does not rewrite history.
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
from quoting.quote import InternalQuote
from schema.job import validate_job_id

UTC = dt.timezone.utc


class RewardKind(str, Enum):
    SUPPLIER_SHARE = "supplier_share"
    REFERRAL = "referral"


@dataclass(frozen=True)
class Accrual:
    accrual_id: str
    kind: RewardKind
    beneficiary_id: str
    job_id: str
    amount: float
    currency: str
    accrued_utc: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "accrual_id": self.accrual_id,
            "kind": self.kind.value,
            "beneficiary_id": self.beneficiary_id,
            "job_id": self.job_id,
            "amount": self.amount,
            "currency": self.currency,
            "accrued_utc": self.accrued_utc,
        }


def validate_beneficiary_id(beneficiary_id: str) -> str:
    """Beneficiary ids become ledger directory names, so the same path-safety
    rule as job ids applies."""
    return validate_job_id(beneficiary_id)


class RewardLedger:
    def __init__(self, root: Path) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def accrue_supplier_share(self, quote: InternalQuote, supplier_id: str) -> Accrual:
        """Record the supplier share this quote already priced in."""
        return self._record(
            RewardKind.SUPPLIER_SHARE,
            beneficiary_id=supplier_id,
            job_id=quote.public.quote_id,
            amount=quote.supplier_share,
            currency=quote.public.currency,
        )

    def accrue_referral(
        self, referrer_id: str, job_id: str, amount: float, currency: str
    ) -> Accrual:
        return self._record(
            RewardKind.REFERRAL,
            beneficiary_id=referrer_id,
            job_id=job_id,
            amount=amount,
            currency=currency,
        )

    def _record(
        self,
        kind: RewardKind,
        beneficiary_id: str,
        job_id: str,
        amount: float,
        currency: str,
    ) -> Accrual:
        validate_beneficiary_id(beneficiary_id)
        validate_job_id(job_id)
        if amount < 0:
            raise ValueError("accrual amount must be non-negative")
        if not currency:
            raise ValueError("currency must be set")

        now = dt.datetime.now(UTC)
        accrual = Accrual(
            accrual_id=uuid.uuid4().hex,
            kind=kind,
            beneficiary_id=beneficiary_id,
            job_id=job_id,
            amount=amount,
            currency=currency,
            accrued_utc=now.isoformat(),
        )
        name = now.strftime("%Y%m%dT%H%M%S.%fZ") + "-" + accrual.accrual_id + ".json"
        atomic_write_json(self._root / beneficiary_id / name, accrual.to_dict())
        return accrual

    def history(self, beneficiary_id: str) -> list[dict[str, Any]]:
        directory = self._root / validate_beneficiary_id(beneficiary_id)
        return [json.loads(path.read_bytes()) for path in sorted(directory.glob("*.json"))]

    def balance(self, beneficiary_id: str, currency: str) -> float:
        return round(
            sum(
                record["amount"]
                for record in self.history(beneficiary_id)
                if record["currency"] == currency
            ),
            6,
        )
