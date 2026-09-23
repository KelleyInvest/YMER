"""Compute Capability Registry (spec section 11, P0 item 1): tracks which
providers can serve which capability tags, and at what capacity, so the
future broker/scheduler can look up a match for a job's requirements."""
from __future__ import annotations

from dataclasses import dataclass

from providers.base import Provider
from schema.capability import Capability
from schema.compute_unit import ComputeUnit


@dataclass(frozen=True)
class CapabilityEntry:
    provider: Provider
    capability: Capability
    capacity: ComputeUnit


class CapabilityRegistry:
    def __init__(self) -> None:
        self._by_capability: dict[Capability, list[CapabilityEntry]] = {}
        self._provider_ids: set[str] = set()

    def register(self, provider: Provider) -> None:
        if provider.provider_id in self._provider_ids:
            raise ValueError(f"provider already registered: {provider.provider_id}")

        advertised = {Capability(tag) for tag in provider.capabilities()}
        outside_lane = advertised - provider.lane
        if outside_lane:
            raise ValueError(
                f"{provider.provider_id} advertises capabilities outside its lane: "
                f"{sorted(c.value for c in outside_lane)}"
            )

        self._provider_ids.add(provider.provider_id)
        for capability, capacity in provider.capabilities().items():
            entry = CapabilityEntry(
                provider=provider, capability=Capability(capability), capacity=capacity
            )
            self._by_capability.setdefault(entry.capability, []).append(entry)

    def lookup(self, capability: Capability, requirements: ComputeUnit) -> list[Provider]:
        """Enabled providers that can serve this capability at this size."""
        return [
            entry.provider
            for entry in self._by_capability.get(Capability(capability), ())
            if entry.provider.enabled and requirements.fits_within(entry.capacity)
        ]

    def providers_for(self, capability: Capability) -> list[Provider]:
        return [entry.provider for entry in self._by_capability.get(Capability(capability), ())]
