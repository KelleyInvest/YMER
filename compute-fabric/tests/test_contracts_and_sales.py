import datetime as dt
import json

import pytest

from contracts.lease import ChangeClass, ConversionTarget, LeaseContract
from contracts.packages import PackageTier, build_catalogue
from markoff.front_desk import NextStep, PublicOffer
from quoting.policy import PricingPolicy
from sales.checkout import (
    Checkout,
    Order,
    OrderState,
    PaymentOutcome,
    PaymentProcessor,
    PaymentResult,
)
from sales.pipeline import Stage, new_lead, qualify
from schema.compute_unit import ComputeUnit

UTC = dt.timezone.utc


def make_lease(**overrides):
    defaults = dict(
        contract_id="lease-1",
        project_id="proj-1",
        capacity_units=100.0,
        starts_at="2026-01-01T00:00:00+00:00",
        ends_at="2026-02-01T00:00:00+00:00",
        price_cap=1_000.0,
    )
    defaults.update(overrides)
    return LeaseContract(**defaults)


# --- lease terms -----------------------------------------------------------


def test_lease_defaults_match_the_spec_shape():
    data = make_lease().to_dict()
    assert data["customer_owns"] == {
        "project_data": True,
        "generated_artifacts": True,
        "configuration_export": True,
    }
    assert data["base_owns"]["orchestration_ip"] is True
    assert data["exit"] == {"export_supported": True, "vendor_lock_required": False}
    assert data["change_control"]["irreversible_changes"]["explicit_approval_required"] is True


def test_lease_refuses_vendor_lock():
    """Spec section 5: a lease is a purchased testing period, not captivity."""
    with pytest.raises(ValueError, match="vendor lock"):
        make_lease(vendor_lock_required=True)


def test_lease_refuses_to_drop_export_support():
    with pytest.raises(ValueError, match="export support"):
        make_lease(export_supported=False)


def test_irreversible_change_always_needs_explicit_approval():
    lease = make_lease()
    assert lease.requires_explicit_approval(ChangeClass.IRREVERSIBLE)
    assert not lease.requires_explicit_approval(ChangeClass.REVERSIBLE)


def test_price_cap_is_enforceable():
    lease = make_lease(price_cap=500.0)
    assert lease.within_cap(499.99)
    assert lease.within_cap(500.0)
    assert not lease.within_cap(500.01)


def test_lease_window_and_validation():
    lease = make_lease()
    assert lease.is_active(dt.datetime(2026, 1, 15, tzinfo=UTC))
    assert not lease.is_active(dt.datetime(2026, 3, 1, tzinfo=UTC))

    with pytest.raises(ValueError):
        make_lease(ends_at="2025-01-01T00:00:00+00:00")
    with pytest.raises(ValueError):
        make_lease(starts_at="2026-01-01T00:00:00")  # naive timestamp
    with pytest.raises(ValueError):
        make_lease(price_cap=-1)


def test_lease_conversion_targets():
    lease = make_lease()
    assert lease.may_convert_to(ConversionTarget.SUBSCRIPTION)
    assert lease.may_convert_to(ConversionTarget.PURCHASE)


# --- packages --------------------------------------------------------------


def test_catalogue_covers_every_tier_and_scales_with_volume():
    catalogue = build_catalogue(unit_cost=1.0)
    assert set(catalogue) == set(PackageTier)

    prices = [catalogue[tier].monthly_price for tier in
              (PackageTier.SUPPORTER, PackageTier.STARTER, PackageTier.GROWTH, PackageTier.SCALE)]
    assert prices == sorted(prices)


def test_larger_tiers_have_a_cheaper_marginal_unit():
    catalogue = build_catalogue(unit_cost=1.0)
    assert catalogue[PackageTier.SCALE].overage_unit_price < (
        catalogue[PackageTier.SUPPORTER].overage_unit_price
    )


def test_package_prices_follow_the_pricing_policy():
    lean = build_catalogue(1.0, PricingPolicy(base_margin=0.10))
    rich = build_catalogue(1.0, PricingPolicy(base_margin=0.50))
    assert rich[PackageTier.GROWTH].monthly_price > lean[PackageTier.GROWTH].monthly_price


def test_package_charges_overage_only_above_the_included_units():
    package = build_catalogue(1.0)[PackageTier.STARTER]
    assert package.price_for(50) == package.monthly_price
    assert package.price_for(100) == package.monthly_price
    assert package.price_for(150) > package.monthly_price

    with pytest.raises(ValueError):
        package.price_for(-1)


# --- checkout --------------------------------------------------------------


class StubProcessor(PaymentProcessor):
    def __init__(self, outcome=PaymentOutcome.AUTHORIZED):
        self._outcome = outcome
        self.calls = []

    def charge(self, amount, currency, authorization_token):
        self.calls.append((amount, currency, authorization_token))
        return PaymentResult(outcome=self._outcome, processor_reference="proc_ref_123")


CARD_FIELD_TERMS = ["pan", "card_number", "cvv", "cvc", "expiry", "cardholder"]


def test_order_has_no_card_fields():
    """PCI scope stays with the processor. If this test ever needs changing,
    the change has pulled this repository into PCI scope."""
    order = Order(order_id="o1", offer_id="of1", amount=10.0, currency="EUR")
    serialized = json.dumps(order.to_dict())

    for term in CARD_FIELD_TERMS:
        assert term not in serialized
        assert not hasattr(order, term)


def test_checkout_only_passes_a_token_to_the_processor():
    processor = StubProcessor()
    checkout = Checkout(processor)
    order = checkout.start(offer_id="of1", amount=25.0, currency="EUR")
    checkout.pay(order, authorization_token="tok_from_browser")

    assert processor.calls == [(25.0, "EUR", "tok_from_browser")]


def test_successful_payment_records_only_the_processor_reference():
    checkout = Checkout(StubProcessor())
    order = checkout.start(offer_id="of1", amount=25.0, currency="EUR")
    paid = checkout.pay(order, authorization_token="tok")

    assert paid.state is OrderState.PAID
    assert paid.processor_reference == "proc_ref_123"


def test_declined_payment_fails_the_order():
    checkout = Checkout(StubProcessor(PaymentOutcome.DECLINED))
    order = checkout.start(offer_id="of1", amount=25.0, currency="EUR")
    assert checkout.pay(order, authorization_token="tok").state is OrderState.FAILED


def test_pending_payment_stays_awaiting():
    checkout = Checkout(StubProcessor(PaymentOutcome.PENDING))
    order = checkout.start(offer_id="of1", amount=25.0, currency="EUR")
    assert checkout.pay(order, "tok").state is OrderState.AWAITING_PAYMENT


def test_checkout_rejects_bad_input_and_double_payment():
    checkout = Checkout(StubProcessor())
    with pytest.raises(ValueError):
        checkout.start(offer_id="of1", amount=0, currency="EUR")

    order = checkout.start(offer_id="of1", amount=25.0, currency="EUR")
    for bad in ["", None, 123]:
        with pytest.raises(ValueError):
            checkout.pay(order, bad)

    paid = checkout.pay(order, "tok")
    with pytest.raises(ValueError):
        checkout.pay(paid, "tok")


def test_paid_order_cannot_be_cancelled():
    checkout = Checkout(StubProcessor())
    paid = checkout.pay(checkout.start("of1", 25.0, "EUR"), "tok")
    with pytest.raises(ValueError, match="refunded"):
        checkout.cancel(paid)


# --- pipeline --------------------------------------------------------------


def make_offer(next_step):
    return PublicOffer(
        offer_id="of1",
        product_class="C2",
        product_description="standard CPU",
        requirements=ComputeUnit(cpu=2, ram=4),
        estimated_monthly_price=100.0,
        price_band_low=70.0,
        price_band_high=200.0,
        currency="EUR",
        next_step=next_step,
        sla_class="standard",
        security_class="standard",
    )


def test_trial_offer_routes_to_self_service():
    lead = qualify(new_lead(), make_offer(NextStep.TRIAL))
    assert lead.stage is Stage.SELF_SERVICE


@pytest.mark.parametrize("step", [NextStep.TALK_TO_KAM, NextStep.BUY])
def test_kam_routing(step):
    """Sales should only receive qualified opportunities: anything unsizeable or
    above the self-service ceiling goes to a human."""
    assert qualify(new_lead(), make_offer(step)).stage is Stage.KAM


def test_pipeline_rejects_an_illegal_transition():
    lead = new_lead()
    with pytest.raises(ValueError, match="cannot move a lead"):
        lead.advance(Stage.PROJECT)


def test_pipeline_records_history_to_a_closed_deal():
    lead = qualify(new_lead(), make_offer(NextStep.TRIAL))
    lead = lead.advance(Stage.TRIAL).advance(Stage.LEASE).advance(Stage.PROJECT)
    assert lead.is_open

    lead = lead.advance(Stage.EXPANSION)
    assert not lead.is_open
    assert lead.history[0] is Stage.LEAD
    assert lead.history[-1] is Stage.EXPANSION


def test_terminal_stages_accept_nothing_further():
    rejected = new_lead().advance(Stage.REJECTED)
    assert not rejected.is_open
    with pytest.raises(ValueError):
        rejected.advance(Stage.QUALIFYING)
