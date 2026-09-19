"""Compute Capability Registry (spec section 11, P0 item 1): tracks which
providers can serve which capability tags, and at what capacity, so the
future broker/scheduler can look up a match for a job's requirements."""
from __future__ import annotations

from dataclasses import dataclass

from providers.base import Provider
from schema.compute_unit import ComputeUnit


@dataclass(frozen=True)
class CapabilityEntry:
    provider: Provider
    capability: str
    capacity: ComputeUnit


class CapabilityRegistry:
    def __init__(self) -> None:
        self._by_capability: dict[str, list[CapabilityEntry]] = {}
        self._provider_ids: set[str] = set()

    def register(self, provider: Provider) -> None:
        if provider.provider_id in self._provider_ids:
            raise ValueError(f"provider already registered: {provider.provider_id}")
        self._provider_ids.add(provider.provider_id)
        for capability, capacity in provider.capabilities().items():
            entry = CapabilityEntry(provider=provider, capability=capability, capacity=capacity)
            self._by_capability.setdefault(capability, []).append(entry)

    def lookup(self, capability: str, requirements: ComputeUnit) -> list[Provider]:
        return [
            entry.provider
            for entry in self._by_capability.get(capability, ())
            if requirements.fits_within(entry.capacity)
        ]

    def providers_for(self, capability: str) -> list[Provider]:
        return [entry.provider for entry in self._by_capability.get(capability, ())]
