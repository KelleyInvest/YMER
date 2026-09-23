import pytest

from kam.estimator import KamEstimator, ProjectInput, SizingThresholds
from providers.local import LocalProvider
from schema.capability import Capability
from schema.compute_unit import ComputeUnit


def make_project(**overrides):
    defaults = dict(
        project_id="proj-1",
        capability=Capability.CPU,
        per_job=ComputeUnit(cpu=1, ram=2),
        jobs_per_month=500,
    )
    defaults.update(overrides)
    return ProjectInput(**defaults)


def make_provider(capacity=None):
    return LocalProvider(capacity=capacity or ComputeUnit(cpu=64, ram=256), cost_per_unit=0.01)


def test_estimate_matches_spec_output_shape():
    estimate = KamEstimator().estimate(make_project(), make_provider())
    data = estimate.to_dict()

    assert data["project"]["id"] == "proj-1"
    assert set(data["budget"]) == {"low", "expected", "high"}
    assert set(data["options"]) == {"poc", "leased", "dedicated", "hybrid"}
    assert set(data["estimated_usage"]) == {"startup", "monthly", "peak"}
    assert data["migration_trigger"]
    assert data["recommendation"]


def test_budget_bands_are_ordered():
    estimate = KamEstimator().estimate(make_project(peak_concurrency=4), make_provider())
    assert estimate.budget["low"] < estimate.budget["expected"] < estimate.budget["high"]


def test_peak_sizing_scales_with_concurrency():
    estimate = KamEstimator().estimate(
        make_project(per_job=ComputeUnit(cpu=2, ram=4), peak_concurrency=8), make_provider()
    )
    assert estimate.requirements.cpu == 16
    assert estimate.requirements.ram == 32


def test_low_volume_recommends_poc():
    estimate = KamEstimator().estimate(make_project(jobs_per_month=100), make_provider())
    assert estimate.recommendation == "poc"


def test_high_spend_recommends_dedicated():
    thresholds = SizingThresholds(dedicated_monthly_cost=10.0)
    estimate = KamEstimator(thresholds=thresholds).estimate(
        make_project(jobs_per_month=100_000), make_provider()
    )
    assert estimate.recommendation == "dedicated"


def test_oversized_project_is_flagged_not_silently_quoted():
    """A project the provider cannot serve must surface as capacity risk rather
    than a confident budget the sales gate would act on."""
    estimate = KamEstimator().estimate(
        make_project(per_job=ComputeUnit(cpu=100, ram=4)), make_provider()
    )
    assert estimate.unserviceable
    assert estimate.risk == "capacity"
    assert estimate.recommendation == "kam_review"
    assert estimate.notes


def test_capability_the_provider_does_not_serve_is_flagged():
    estimate = KamEstimator().estimate(
        make_project(capability=Capability.RENDER), make_provider()
    )
    assert estimate.unserviceable
    assert "does not serve render" in estimate.notes[0]


def test_rejects_invalid_project_input():
    with pytest.raises(ValueError):
        make_project(peak_concurrency=0)
    with pytest.raises(ValueError):
        make_project(jobs_per_month=-1)
