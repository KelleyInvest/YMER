"""Quote types (spec section 4: information barriers).

The barrier is enforced by the type system rather than by filtering at the API
edge. A PublicQuote physically has no field for upstream cost, margin or
provider identity, so a client-facing serialization cannot leak them no matter
which layer does the serializing. InternalQuote carries the sourcing detail and
holds its PublicQuote rather than inheriting from it, so it can never be passed
where a PublicQuote is expected and silently over-disclose.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from schema.capability import Capability
from schema.compute_unit import ComputeUnit


@dataclass(frozen=True)
class PublicQuote:
    """What the client is allowed to see (spec section 7: 'BASE RENDER CLASS R4,
    32 GB VRAM, X compute units, delivery target Y' — not provider or our cost)."""

    quote_id: str
    capability: Capability
    requirements: ComputeUnit
    client_price: float
    currency: str
    delivery_target_seconds: float
    sla_class: str
    security_class: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "quote_id": self.quote_id,
            "capability": self.capability.value,
            "requirements": self.requirements.to_dict(),
            "client_price": self.client_price,
            "currency": self.currency,
            "delivery_target_seconds": self.delivery_target_seconds,
            "sla_class": self.sla_class,
            "security_class": self.security_class,
        }


@dataclass(frozen=True)
class InternalQuote:
    """Broker/treasury view: the same quote plus the sourcing and margin detail
    that spec section 4 keeps behind the barrier."""

    public: PublicQuote
    provider_id: str
    upstream_cost: float
    supplier_share: float
    kam_acquisition: float
    reserve: float
    free_rewards: float
    base_margin: float

    def to_public(self) -> PublicQuote:
        return self.public

    def to_dict(self) -> dict[str, Any]:
        return {
            "public": self.public.to_dict(),
            "provider_id": self.provider_id,
            "upstream_cost": self.upstream_cost,
            "supplier_share": self.supplier_share,
            "kam_acquisition": self.kam_acquisition,
            "reserve": self.reserve,
            "free_rewards": self.free_rewards,
            "base_margin": self.base_margin,
        }
