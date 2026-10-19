"""Lease-to-project terms (spec section 5, P3 item 3).

    Lease is a purchased testing period, not architecture captivity.

This is a machine-readable model of the commercial terms so the fabric can
enforce the operational ones: a price cap the meter checks against, a change
class that decides whether an action needs explicit approval, an export
guarantee the exit path has to honour.

NOT LEGAL TEXT. These defaults encode spec section 5's intent so code can act on
it; the binding agreement a customer signs is drafted and reviewed by counsel.
Where the two ever disagree, the signed agreement governs and this model is the
thing that is wrong.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

UTC = dt.timezone.utc


class ChangeClass(str, Enum):
    REVERSIBLE = "reversible"
    IRREVERSIBLE = "irreversible"


class ConversionTarget(str, Enum):
    SUBSCRIPTION = "subscription"
    RESERVED_CAPACITY = "reserved_capacity"
    DEDICATED_NODE = "dedicated_node"
    PURCHASE = "purchase"


@dataclass(frozen=True)
class Ownership:
    """Spec section 5 splits this explicitly, so it is modelled explicitly."""

    customer_project_data: bool = True
    customer_generated_artifacts: bool = True
    customer_configuration_export: bool = True
    base_orchestration_ip: bool = True
    base_routing_logic: bool = True
    base_supplier_contracts: bool = True


@dataclass(frozen=True)
class LeaseContract:
    contract_id: str
    project_id: str
    capacity_units: float
    starts_at: str
    ends_at: str
    price_cap: float
    currency: str = "EUR"
    ownership: Ownership = field(default_factory=Ownership)
    export_supported: bool = True
    vendor_lock_required: bool = False
    reversible_changes_preferred: bool = True
    conversion_targets: tuple[ConversionTarget, ...] = tuple(ConversionTarget)

    def __post_init__(self) -> None:
        if self.price_cap < 0:
            raise ValueError("price_cap must be non-negative")
        if self.capacity_units <= 0:
            raise ValueError("capacity_units must be positive")
        if _parse(self.ends_at) <= _parse(self.starts_at):
            raise ValueError("lease must end after it starts")
        if self.vendor_lock_required:
            raise ValueError(
                "spec section 5 forbids vendor lock: lease is a purchased testing "
                "period, not architecture captivity"
            )
        if not self.export_supported:
            raise ValueError("export support is not optional under spec section 5")

    def within_cap(self, spend: float) -> bool:
        return spend <= self.price_cap

    def requires_explicit_approval(self, change: ChangeClass) -> bool:
        """Irreversible changes always need the customer to say yes."""
        return ChangeClass(change) is ChangeClass.IRREVERSIBLE

    def is_active(self, at: dt.datetime | None = None) -> bool:
        moment = at or dt.datetime.now(UTC)
        return _parse(self.starts_at) <= moment < _parse(self.ends_at)

    def may_convert_to(self, target: ConversionTarget) -> bool:
        return ConversionTarget(target) in self.conversion_targets

    def to_dict(self) -> dict[str, Any]:
        return {
            "contract_id": self.contract_id,
            "project_id": self.project_id,
            "lease": {
                "capacity": self.capacity_units,
                "start": self.starts_at,
                "end": self.ends_at,
                "price_cap": self.price_cap,
                "currency": self.currency,
            },
            "customer_owns": {
                "project_data": self.ownership.customer_project_data,
                "generated_artifacts": self.ownership.customer_generated_artifacts,
                "configuration_export": self.ownership.customer_configuration_export,
            },
            "base_owns": {
                "orchestration_ip": self.ownership.base_orchestration_ip,
                "routing_logic": self.ownership.base_routing_logic,
                "supplier_contracts": self.ownership.base_supplier_contracts,
            },
            "change_control": {
                "reversible_changes_preferred": self.reversible_changes_preferred,
                "irreversible_changes": {"explicit_approval_required": True},
            },
            "exit": {
                "export_supported": self.export_supported,
                "vendor_lock_required": self.vendor_lock_required,
            },
            "conversion": {"may_convert_to": [t.value for t in self.conversion_targets]},
        }


def _parse(value: str) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("lease timestamps must carry a timezone")
    return parsed.astimezone(UTC)
