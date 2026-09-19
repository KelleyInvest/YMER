"""Provider abstraction (spec section 6-7): a uniform interface every
compute source (CPU, GPU lease, MRR, Render, HF, ...) implements, so the
broker/registry never needs to know provider-specific details."""
from __future__ import annotations

import abc
from dataclasses import dataclass

from schema.compute_unit import ComputeUnit
from schema.job import Job


@dataclass(frozen=True)
class JobHandle:
    provider_id: str
    provider_job_id: str


class Provider(abc.ABC):
    """Base class for a compute source adapter."""

    provider_id: str

    @abc.abstractmethod
    def capabilities(self) -> dict[str, ComputeUnit]:
        """Return {capability_tag: max available ComputeUnit} for this provider."""

    @abc.abstractmethod
    def submit(self, job: Job) -> JobHandle:
        """Submit a job to this provider and return a handle for tracking."""

    @abc.abstractmethod
    def status(self, handle: JobHandle) -> str:
        """Return the provider-reported status for a previously submitted job."""

    @abc.abstractmethod
    def cost_estimate(self, job: Job) -> float:
        """Return an estimated cost (in the fabric's base currency unit) for the job."""
