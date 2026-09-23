import pytest

from quoting.generator import QuoteGenerator
from providers.local import LocalProvider
from schema.capability import Capability
from schema.compute_unit import ComputeUnit
from schema.job import Job
from treasury.controls import PayoutRefused, Refusal, TreasuryControls
from treasury.free_points import FreePointsLedger, InsufficientPoints
from treasury.rewards import RewardKind, RewardLedger
from treasury.settlement import (
    LedgerOnlyRail,
    ObligationState,
    SettlementLedger,
    SettlementRail,
)


# --- supplier and referral accrual -----------------------------------------


def make_quote():
    job = Job(requirements=ComputeUnit(cpu=2, ram=4), capability=Capability.CPU)
    provider = LocalProvider(capacity=ComputeUnit(cpu=8, ram=32), cost_per_unit=1.0)
    return QuoteGenerator().quote(job, provider, delivery_target_seconds=60)


def test_supplier_accrual_matches_the_quoted_share(tmp_path):
    """What is accrued is what the client price already contained."""
    ledger = RewardLedger(tmp_path / "rewards")
    quote = make_quote()
    accrual = ledger.accrue_supplier_share(quote, supplier_id="supplier-1")

    assert accrual.kind is RewardKind.SUPPLIER_SHARE
    assert accrual.amount == quote.supplier_share
    assert ledger.balance("supplier-1", quote.public.currency) == quote.supplier_share


def test_accruals_accumulate_and_are_append_only(tmp_path):
    ledger = RewardLedger(tmp_path / "rewards")
    quote = make_quote()
    ledger.accrue_supplier_share(quote, supplier_id="supplier-1")
    ledger.accrue_supplier_share(quote, supplier_id="supplier-1")

    assert len(ledger.history("supplier-1")) == 2
    assert ledger.balance("supplier-1", quote.public.currency) == quote.supplier_share * 2


def test_referral_accrual(tmp_path):
    ledger = RewardLedger(tmp_path / "rewards")
    ledger.accrue_referral("referrer-1", job_id="job1", amount=5.0, currency="EUR")
    assert ledger.balance("referrer-1", "EUR") == 5.0


def test_balance_is_currency_specific(tmp_path):
    ledger = RewardLedger(tmp_path / "rewards")
    ledger.accrue_referral("r1", job_id="j1", amount=5.0, currency="EUR")
    ledger.accrue_referral("r1", job_id="j2", amount=7.0, currency="NOK")
    assert ledger.balance("r1", "EUR") == 5.0
    assert ledger.balance("r1", "NOK") == 7.0


def test_reward_ledger_rejects_unsafe_ids_and_negative_amounts(tmp_path):
    ledger = RewardLedger(tmp_path / "rewards")
    with pytest.raises(ValueError):
        ledger.accrue_referral("../../escape", job_id="j1", amount=1.0, currency="EUR")
    with pytest.raises(ValueError):
        ledger.accrue_referral("r1", job_id="../../escape", amount=1.0, currency="EUR")
    with pytest.raises(ValueError):
        ledger.accrue_referral("r1", job_id="j1", amount=-1.0, currency="EUR")


# --- FREE Points -----------------------------------------------------------

FORBIDDEN_POINTS_METHODS = ["transfer", "redeem_for_cash", "withdraw", "convert_to_token", "send"]


def test_free_points_have_no_transfer_or_cash_out(tmp_path):
    """FREE Points are a loyalty balance, not a token. No transfer between
    accounts and no cash-out is what keeps them one. Adding either is a
    regulatory decision, so the methods must not quietly appear."""
    ledger = FreePointsLedger(tmp_path / "points")
    for name in FORBIDDEN_POINTS_METHODS:
        assert not hasattr(ledger, name)


def test_points_earn_and_spend(tmp_path):
    ledger = FreePointsLedger(tmp_path / "points")
    ledger.earn("acct-1", 100, reason="compute spend")
    ledger.spend("acct-1", 30, reason="discount on invoice")
    assert ledger.balance("acct-1") == 70


def test_points_cannot_be_overspent(tmp_path):
    ledger = FreePointsLedger(tmp_path / "points")
    ledger.earn("acct-1", 10, reason="compute spend")
    with pytest.raises(InsufficientPoints):
        ledger.spend("acct-1", 11, reason="too much")


def test_points_expire(tmp_path):
    ledger = FreePointsLedger(tmp_path / "points")
    ledger.earn("acct-1", 50, reason="compute spend")
    ledger.expire("acct-1", 20)
    assert ledger.balance("acct-1") == 30


def test_points_movements_require_a_reason(tmp_path):
    """Points are minted against recorded activity, never arbitrarily."""
    ledger = FreePointsLedger(tmp_path / "points")
    with pytest.raises(ValueError):
        ledger.earn("acct-1", 10, reason="")


@pytest.mark.parametrize("bad", [0, -5, 1.5, True, "10"])
def test_points_must_be_a_positive_int(tmp_path, bad):
    ledger = FreePointsLedger(tmp_path / "points")
    with pytest.raises(ValueError):
        ledger.earn("acct-1", bad, reason="x")


# --- treasury controls -----------------------------------------------------


def test_controls_allow_a_payout_within_every_limit():
    TreasuryControls().check(amount=100.0, balance=5_000.0, paid_today=0.0)


def test_reserve_floor_is_protected():
    controls = TreasuryControls(reserve_floor=1_000.0)
    with pytest.raises(PayoutRefused) as excinfo:
        controls.check(amount=500.0, balance=1_200.0)
    assert excinfo.value.reason is Refusal.BELOW_RESERVE


def test_per_payout_ceiling():
    controls = TreasuryControls(max_payout=100.0, approval_threshold=100.0)
    with pytest.raises(PayoutRefused) as excinfo:
        controls.check(amount=101.0, balance=1_000_000.0)
    assert excinfo.value.reason is Refusal.OVER_PAYOUT_LIMIT


def test_daily_ceiling_counts_what_already_went_out():
    controls = TreasuryControls(max_payout=100.0, max_daily_payout=150.0, approval_threshold=100.0)
    with pytest.raises(PayoutRefused) as excinfo:
        controls.check(amount=100.0, balance=1_000_000.0, paid_today=100.0)
    assert excinfo.value.reason is Refusal.OVER_DAILY_LIMIT


def test_large_payout_needs_approval():
    controls = TreasuryControls(approval_threshold=100.0)
    with pytest.raises(PayoutRefused) as excinfo:
        controls.check(amount=200.0, balance=1_000_000.0)
    assert excinfo.value.reason is Refusal.NEEDS_APPROVAL

    controls.check(amount=200.0, balance=1_000_000.0, approved=True)


def test_controls_reject_incoherent_configuration():
    with pytest.raises(ValueError):
        TreasuryControls(max_payout=100.0, max_daily_payout=50.0)
    with pytest.raises(ValueError):
        TreasuryControls(reserve_floor=-1)


# --- settlement ------------------------------------------------------------


def test_no_crypto_rail_is_shipped():
    """Spec P4 names SOL settlement. Implementing a rail that moves client value
    is a regulated decision, so only the ledger-only rail exists here.

    Every treasury module is imported first: __subclasses__ only sees what has
    been imported, so without this the test would pass while a rail sat
    unimported in the package.
    """
    import importlib
    import pkgutil

    import treasury

    for module in pkgutil.iter_modules(treasury.__path__):
        importlib.import_module(f"treasury.{module.name}")

    shipped = {cls.rail_id for cls in SettlementRail.__subclasses__()}
    assert shipped == {"ledger-only"}


def test_recording_an_obligation_does_not_pay_it(tmp_path):
    ledger = SettlementLedger(tmp_path / "settlement")
    obligation = ledger.record("supplier-1", amount=50.0, currency="EUR")

    assert obligation.state is ObligationState.RECORDED
    assert obligation.rail == "unassigned"
    assert obligation.rail_reference is None
    assert ledger.outstanding("supplier-1", "EUR") == 50.0


def test_settling_clears_the_outstanding_balance(tmp_path):
    ledger = SettlementLedger(tmp_path / "settlement")
    obligation = ledger.record("supplier-1", amount=50.0, currency="EUR")
    settled = ledger.settle(obligation, LedgerOnlyRail(), balance=10_000.0)

    assert settled.state is ObligationState.SETTLED
    assert settled.rail == "ledger-only"
    assert settled.rail_reference.startswith("ledger:")
    assert ledger.outstanding("supplier-1", "EUR") == 0.0


def test_settlement_trail_keeps_both_states(tmp_path):
    """The record should show recorded-then-settled, not a single mutated row."""
    ledger = SettlementLedger(tmp_path / "settlement")
    obligation = ledger.record("supplier-1", amount=50.0, currency="EUR")
    ledger.settle(obligation, LedgerOnlyRail(), balance=10_000.0)

    states = [record["state"] for record in ledger.history("supplier-1")]
    assert states == ["recorded", "settled"]


def test_settlement_enforces_treasury_controls(tmp_path):
    ledger = SettlementLedger(
        tmp_path / "settlement", controls=TreasuryControls(reserve_floor=1_000.0)
    )
    obligation = ledger.record("supplier-1", amount=500.0, currency="EUR")

    with pytest.raises(PayoutRefused):
        ledger.settle(obligation, LedgerOnlyRail(), balance=1_200.0)
    assert ledger.outstanding("supplier-1", "EUR") == 500.0  # still owed


def test_an_obligation_cannot_be_settled_twice(tmp_path):
    ledger = SettlementLedger(tmp_path / "settlement")
    obligation = ledger.record("supplier-1", amount=50.0, currency="EUR")
    settled = ledger.settle(obligation, LedgerOnlyRail(), balance=10_000.0)

    with pytest.raises(ValueError):
        ledger.settle(settled, LedgerOnlyRail(), balance=10_000.0)


def test_settlement_rejects_unsafe_ids_and_bad_amounts(tmp_path):
    ledger = SettlementLedger(tmp_path / "settlement")
    with pytest.raises(ValueError):
        ledger.record("../../escape", amount=1.0, currency="EUR")
    with pytest.raises(ValueError):
        ledger.record("supplier-1", amount=0, currency="EUR")
