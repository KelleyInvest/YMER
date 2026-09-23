"""KAM estimator (spec section 11, P1 item 4).

Turns a project description into the sizing/budget/recommendation output shape
defined in spec section 3, so a KAM conversation produces a structured artifact
the sales gate can act on. Budget bands come from the real quote math rather
than a separate rate card, so an estimate and the quote a client later receives
cannot drift apart.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from providers.base import Provider
from quoting.generator import QuoteGenerator
from schema.capability import Capability
from schema.compute_unit import ComputeUnit
from schema.job import Job


@dataclass(frozen=True)
class SizingThresholds:
    poc_jobs_per_month: int = 1_000
    leased_jobs_per_month: int = 50_000
    quiet_month_factor: float = 0.7
    dedicated_monthly_cost: float = 2_000.0


@dataclass(frozen=True)
class ProjectInput:
    project_id: str
    capability: Capability
    per_job: ComputeUnit
    jobs_per_month: int
    peak_concurrency: int = 1
    storage_gb: float = 0.0

    def __post_init__(self) -> None:
        if not self.project_id:
            raise ValueError("project_id must be set")
        if self.jobs_per_month < 0:
            raise ValueError("jobs_per_month must be non-negative")
        if self.peak_concurrency < 1:
            raise ValueError("peak_concurrency must be at least 1")


@dataclass(frozen=True)
class Estimate:
    project_id: str
    requirements: ComputeUnit
    estimated_usage: dict[str, Any]
    options: dict[str, Any]
    budget: dict[str, float]
    migration_trigger: str
    risk: str
    recommendation: str
    unserviceable: bool = False
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "project": {"id": self.project_id},
            "requirements": self.requirements.to_dict(),
            "estimated_usage": self.estimated_usage,
            "options": self.options,
            "budget": self.budget,
            "migration_trigger": self.migration_trigger,
            "risk": self.risk,
            "recommendation": self.recommendation,
            "unserviceable": self.unserviceable,
            "notes": self.notes,
        }


class KamEstimator:
    def __init__(
        self,
        generator: QuoteGenerator | None = None,
        thresholds: SizingThresholds | None = None,
    ) -> None:
        self._generator = generator or QuoteGenerator()
        self._thresholds = thresholds or SizingThresholds()

    @property
    def currency(self) -> str:
        return self._generator.policy.currency

    def estimate(self, project: ProjectInput, provider: Provider) -> Estimate:
        thresholds = self._thresholds
        peak_requirements = _scale(project.per_job, project.peak_concurrency, project.storage_gb)

        probe = Job(requirements=project.per_job, capability=project.capability)
        per_job_price = self._generator.quote(
            probe, provider, delivery_target_seconds=0
        ).public.client_price

        expected = per_job_price * project.jobs_per_month
        budget = {
            "low": round(expected * thresholds.quiet_month_factor, 2),
            "expected": round(expected, 2),
            "high": round(expected * project.peak_concurrency, 2),
        }

        notes: list[str] = []
        capacity = provider.capabilities().get(project.capability)
        unserviceable = capacity is None or not peak_requirements.fits_within(capacity)
        if capacity is None:
            notes.append(f"{provider.provider_id} does not serve {project.capability.value}")
        elif unserviceable:
            notes.append(
                f"peak sizing exceeds {provider.provider_id} capacity; needs a larger lane "
                "or a second provider"
            )

        return Estimate(
            project_id=project.project_id,
            requirements=peak_requirements,
            estimated_usage={
                "startup": min(project.jobs_per_month, thresholds.poc_jobs_per_month),
                "monthly": project.jobs_per_month,
                "peak": project.jobs_per_month * project.peak_concurrency,
            },
            options=self._options(project, per_job_price, thresholds),
            budget=budget,
            migration_trigger=(
                f"expected monthly spend above {thresholds.dedicated_monthly_cost:.0f} "
                f"{self.currency}, or sustained peak at capacity"
            ),
            risk="capacity" if unserviceable else "low",
            recommendation=self._recommendation(project, expected, thresholds, unserviceable),
            unserviceable=unserviceable,
            notes=notes,
        )

    def _options(
        self, project: ProjectInput, per_job_price: float, thresholds: SizingThresholds
    ) -> dict[str, Any]:
        poc_jobs = min(project.jobs_per_month, thresholds.poc_jobs_per_month)
        return {
            "poc": {"jobs": poc_jobs, "cost": round(per_job_price * poc_jobs, 2)},
            "leased": {"jobs": project.jobs_per_month, "cost": round(
                per_job_price * project.jobs_per_month, 2
            )},
            "dedicated": {"monthly_cost": thresholds.dedicated_monthly_cost},
            "hybrid": {
                "description": "leased baseline with burst capacity for peak",
                "monthly_cost": round(
                    per_job_price * project.jobs_per_month
                    + thresholds.dedicated_monthly_cost / 2,
                    2,
                ),
            },
        }

    def _recommendation(
        self,
        project: ProjectInput,
        expected: float,
        thresholds: SizingThresholds,
        unserviceable: bool,
    ) -> str:
        if unserviceable:
            return "kam_review"
        if expected > thresholds.dedicated_monthly_cost:
            return "dedicated"
        if project.jobs_per_month <= thresholds.poc_jobs_per_month:
            return "poc"
        if project.jobs_per_month <= thresholds.leased_jobs_per_month:
            return "leased"
        return "dedicated"


def _scale(unit: ComputeUnit, concurrency: int, storage_gb: float) -> ComputeUnit:
    return ComputeUnit(
        cpu=unit.cpu * concurrency,
        ram=unit.ram * concurrency,
        gpu=unit.gpu * concurrency,
        vram=unit.vram * concurrency,
        storage=max(unit.storage * concurrency, storage_gb),
        bandwidth=unit.bandwidth * concurrency,
    )
