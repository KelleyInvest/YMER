"""Pricing policy (spec section 8).

Client price is composed of upstream compute plus a set of shares. Spec section 8
is explicit that the supplier share "should be a policy variable, not hard-coded
accounting", so every band here is a configurable rate applied to upstream cost.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PricingPolicy:
    supplier_share: float = 0.10
    kam_acquisition: float = 0.05
    reserve: float = 0.05
    free_rewards: float = 0.02
    base_margin: float = 0.25
    currency: str = "EUR"

    def __post_init__(self) -> None:
        for name in ("supplier_share", "kam_acquisition", "reserve", "free_rewards", "base_margin"):
            rate = getattr(self, name)
            if not isinstance(rate, (int, float)) or isinstance(rate, bool) or rate < 0:
                raise ValueError(f"{name} must be a non-negative rate")
        if not self.currency:
            raise ValueError("currency must be set")

    @property
    def total_uplift(self) -> float:
        return (
            self.supplier_share
            + self.kam_acquisition
            + self.reserve
            + self.free_rewards
            + self.base_margin
        )
