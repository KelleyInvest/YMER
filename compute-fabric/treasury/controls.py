"""Treasury controls (spec section 11, P4 item 6).

Limits that apply to any payout regardless of which rail eventually carries it:
a reserve floor the balance may not be drawn below, a per-payout ceiling, a
daily ceiling, and a threshold above which a human has to approve.

These are ordinary prudential controls, not a substitute for the regulatory
question. Holding client funds in reserve is a regulated activity in many
jurisdictions, so what this module does is constrain payouts — it does not
decide whether BASE may hold the money in the first place.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Refusal(str, Enum):
    BELOW_RESERVE = "would draw balance below reserve floor"
    OVER_PAYOUT_LIMIT = "exceeds per-payout ceiling"
    OVER_DAILY_LIMIT = "exceeds daily ceiling"
    NEEDS_APPROVAL = "exceeds approval threshold and is not approved"


class PayoutRefused(RuntimeError):
    def __init__(self, reason: Refusal) -> None:
        super().__init__(reason.value)
        self.reason = reason


@dataclass(frozen=True)
class TreasuryControls:
    reserve_floor: float = 0.0
    max_payout: float = 1_000.0
    max_daily_payout: float = 10_000.0
    approval_threshold: float = 500.0

    def __post_init__(self) -> None:
        for name in ("reserve_floor", "max_payout", "max_daily_payout", "approval_threshold"):
            value = getattr(self, name)
            if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
                raise ValueError(f"{name} must be a non-negative number")
        if self.max_payout > self.max_daily_payout:
            raise ValueError("per-payout ceiling cannot exceed the daily ceiling")

    def check(
        self,
        amount: float,
        balance: float,
        paid_today: float = 0.0,
        approved: bool = False,
    ) -> None:
        """Raise PayoutRefused unless every control passes."""
        if amount <= 0:
            raise ValueError("payout amount must be positive")
        if amount > self.max_payout:
            raise PayoutRefused(Refusal.OVER_PAYOUT_LIMIT)
        if paid_today + amount > self.max_daily_payout:
            raise PayoutRefused(Refusal.OVER_DAILY_LIMIT)
        if balance - amount < self.reserve_floor:
            raise PayoutRefused(Refusal.BELOW_RESERVE)
        if amount > self.approval_threshold and not approved:
            raise PayoutRefused(Refusal.NEEDS_APPROVAL)
