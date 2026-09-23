import json

import pytest

from providers.local import LocalProvider
from quoting.generator import QuoteGenerator
from quoting.policy import PricingPolicy
from schema.capability import Capability
from schema.compute_unit import ComputeUnit
from schema.job import Job


def make_job():
    return Job(requirements=ComputeUnit(cpu=2, ram=4), capability=Capability.CPU)


def make_provider():
    return LocalProvider(capacity=ComputeUnit(cpu=8, ram=32), cost_per_unit=1.0)


def test_client_price_applies_every_policy_band():
    policy = PricingPolicy(
        supplier_share=0.10,
        kam_acquisition=0.05,
        reserve=0.05,
        free_rewards=0.02,
        base_margin=0.25,
    )
    quote = QuoteGenerator(policy).quote(make_job(), make_provider(), delivery_target_seconds=60)

    # LocalProvider costs cost_per_unit * (cpu + ram) = 1.0 * 6
    assert quote.upstream_cost == 6.0
    assert quote.public.client_price == pytest.approx(6.0 * 1.47)


def test_supplier_share_is_a_policy_variable():
    """Spec section 8: the supplier share is configurable, not hard-coded."""
    job, provider = make_job(), make_provider()
    default = QuoteGenerator().quote(job, provider, delivery_target_seconds=60)
    raised = QuoteGenerator(PricingPolicy(supplier_share=0.20)).quote(
        job, provider, delivery_target_seconds=60
    )

    assert default.supplier_share == pytest.approx(0.6)
    assert raised.supplier_share == pytest.approx(1.2)
    assert raised.public.client_price > default.public.client_price


def test_policy_rejects_negative_rate():
    with pytest.raises(ValueError):
        PricingPolicy(base_margin=-0.1)


INTERNAL_ONLY_TERMS = [
    "upstream_cost",
    "supplier_share",
    "kam_acquisition",
    "reserve",
    "free_rewards",
    "base_margin",
    "provider_id",
]


def test_public_quote_carries_no_internal_fields():
    """Spec section 4: exact provider, wholesale cost and margin stay behind the
    barrier. The public payload must not contain them under any key."""
    quote = QuoteGenerator().quote(make_job(), make_provider(), delivery_target_seconds=60)
    serialized = json.dumps(quote.to_public().to_dict())

    for term in INTERNAL_ONLY_TERMS:
        assert term not in serialized
    assert "local" not in serialized  # the provider_id of the chosen provider


def test_public_quote_has_no_internal_attributes():
    """A leak would most likely come from someone reaching for an attribute, so
    the field must not exist at all rather than merely be omitted from to_dict."""
    public = QuoteGenerator().quote(
        make_job(), make_provider(), delivery_target_seconds=60
    ).to_public()

    for term in INTERNAL_ONLY_TERMS:
        assert not hasattr(public, term)


def test_internal_quote_retains_sourcing_detail():
    quote = QuoteGenerator().quote(make_job(), make_provider(), delivery_target_seconds=60)
    assert quote.provider_id == "local"
    assert quote.upstream_cost == 6.0
