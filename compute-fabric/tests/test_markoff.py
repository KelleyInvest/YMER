import json

import pytest

from kam.estimator import ProjectInput
from markoff.front_desk import MarkoffFrontDesk, NextStep, PublicOffer
from markoff.product import classify
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


def make_provider(capacity=None, cost=0.01):
    return LocalProvider(capacity=capacity or ComputeUnit(cpu=64, ram=256), cost_per_unit=cost)


def test_classify_picks_the_smallest_fitting_class():
    assert classify(Capability.CPU, ComputeUnit(cpu=1, ram=4)).code == "C1"
    assert classify(Capability.CPU, ComputeUnit(cpu=6, ram=16)).code == "C2"
    assert classify(Capability.CPU, ComputeUnit(cpu=20, ram=100)).code == "C4"


def test_classify_returns_none_when_nothing_fits():
    assert classify(Capability.CPU, ComputeUnit(cpu=10_000)) is None
    assert classify(Capability.HASHRATE, ComputeUnit()) is None


def test_offer_names_a_product_class_not_a_provider():
    result = MarkoffFrontDesk().offer(make_project(), make_provider())
    assert result.offer.product_class.startswith("C")


INTERNAL_ONLY_TERMS = [
    "upstream_cost",
    "supplier_share",
    "kam_acquisition",
    "base_margin",
    "provider_id",
    "free_rewards",
]


def test_public_offer_carries_no_internal_fields():
    """Spec section 4: the public entry point must not expose sourcing or margin."""
    result = MarkoffFrontDesk().offer(make_project(), make_provider())
    serialized = json.dumps(result.offer.to_dict())

    for term in INTERNAL_ONLY_TERMS:
        assert term not in serialized
    assert "local" not in serialized  # the provider that priced it


def test_public_offer_has_no_internal_attributes():
    result = MarkoffFrontDesk().offer(make_project(), make_provider())
    for term in INTERNAL_ONLY_TERMS:
        assert not hasattr(result.offer, term)


def test_internal_estimate_is_kept_separate_from_the_offer():
    """Handing a client the offer must not hand them the estimate behind it."""
    result = MarkoffFrontDesk().offer(
        make_project(per_job=ComputeUnit(cpu=500)), make_provider()
    )
    # The estimator's capacity notes name provider limitations, so they are
    # internal commentary and must not ride along in the client payload.
    assert result.internal_estimate.notes
    assert "notes" not in result.offer.to_dict()
    assert not hasattr(result.offer, "internal_estimate")


def test_small_project_is_offered_a_trial():
    front_desk = MarkoffFrontDesk(trial_ceiling=1_000.0, buy_floor=50_000.0)
    result = front_desk.offer(make_project(jobs_per_month=10), make_provider())
    assert result.offer.next_step is NextStep.TRIAL


def test_large_project_is_routed_to_buy():
    front_desk = MarkoffFrontDesk(trial_ceiling=1.0, buy_floor=10.0)
    result = front_desk.offer(make_project(jobs_per_month=100_000), make_provider())
    assert result.offer.next_step is NextStep.BUY


def test_unsizeable_project_goes_to_a_human_rather_than_getting_a_number():
    """A project we cannot serve must not receive a confident self-service price
    the sales gate would then have to walk back."""
    result = MarkoffFrontDesk().offer(
        make_project(per_job=ComputeUnit(cpu=500)), make_provider()
    )
    assert result.offer.next_step is NextStep.TALK_TO_KAM


def test_capability_with_no_product_class_goes_to_a_human():
    result = MarkoffFrontDesk().offer(
        make_project(capability=Capability.HASHRATE), make_provider()
    )
    assert result.offer.next_step is NextStep.TALK_TO_KAM


def test_price_bands_are_ordered():
    offer = MarkoffFrontDesk().offer(
        make_project(peak_concurrency=3), make_provider()
    ).offer
    assert offer.price_band_low <= offer.estimated_monthly_price <= offer.price_band_high
