"""Supporter and subscription packages (spec section 11, P3 item 4).

Packages are priced from the same PricingPolicy the quote generator uses, so a
package price and an equivalent metered quote stay in the same relationship
rather than drifting into two separate price lists.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

from quoting.policy import PricingPolicy


class PackageTier(str, Enum):
    SUPPORTER = "supporter"
    STARTER = "starter"
    GROWTH = "growth"
    SCALE = "scale"


@dataclass(frozen=True)
class Package:
    tier: PackageTier
    included_units: float
    monthly_price: float
    currency: str = "EUR"
    overage_unit_price: float = 0.0

    def __post_init__(self) -> None:
        if self.monthly_price < 0 or self.overage_unit_price < 0:
            raise ValueError("package prices must be non-negative")
        if self.included_units < 0:
            raise ValueError("included_units must be non-negative")

    def price_for(self, units_used: float) -> float:
        if units_used < 0:
            raise ValueError("units_used must be non-negative")
        overage = max(0.0, units_used - self.included_units)
        return round(self.monthly_price + overage * self.overage_unit_price, 2)

    def to_dict(self) -> dict[str, Any]:
        return {
            "tier": self.tier.value,
            "included_units": self.included_units,
            "monthly_price": self.monthly_price,
            "currency": self.currency,
            "overage_unit_price": self.overage_unit_price,
        }


def build_catalogue(
    unit_cost: float, policy: PricingPolicy | None = None
) -> dict[PackageTier, Package]:
    """Derive the package list from upstream unit cost and the pricing policy.

    Larger tiers commit to more volume up front, so they carry a discount on the
    marginal unit; the policy uplift still applies to every tier.
    """
    policy = policy or PricingPolicy()
    if unit_cost < 0:
        raise ValueError("unit_cost must be non-negative")
    retail = unit_cost * (1 + policy.total_uplift)

    plan = {
        PackageTier.SUPPORTER: (10.0, 1.00),
        PackageTier.STARTER: (100.0, 0.95),
        PackageTier.GROWTH: (1_000.0, 0.85),
        PackageTier.SCALE: (10_000.0, 0.75),
    }
    return {
        tier: Package(
            tier=tier,
            included_units=units,
            monthly_price=round(retail * units * discount, 2),
            currency=policy.currency,
            overage_unit_price=round(retail * discount, 6),
        )
        for tier, (units, discount) in plan.items()
    }
