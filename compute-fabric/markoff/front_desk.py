"""MARKOFF front desk (spec sections 2 and 11, P3 item 1).

    PROJECT INPUT -> rough sizing -> estimated compute units -> estimated budget
    -> TRIAL / LEASE / BUY / TALK TO KAM

This is the server side of the public entry point. It reuses the KAM estimator
so a self-service visitor and an advised client are sized by the same rules —
if the two diverged, the advisory conversation would be negotiating against
different numbers than the web page quoted.

Everything it returns is client-facing, so it is assembled from PublicQuote and
ProductClass only. No field here can carry upstream cost, margin or provider
identity, which is spec section 4's barrier expressed as a return type.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import Enum
from typing import Any

from kam.estimator import Estimate, KamEstimator, ProjectInput
from markoff.product import ProductClass, classify
from providers.base import Provider
from schema.compute_unit import ComputeUnit


class NextStep(str, Enum):
    TRIAL = "trial"
    LEASE = "lease"
    BUY = "buy"
    TALK_TO_KAM = "talk_to_kam"


@dataclass(frozen=True)
class PublicOffer:
    """The whole client-visible surface of a self-service quote."""

    offer_id: str
    product_class: str
    product_description: str
    requirements: ComputeUnit
    estimated_monthly_price: float
    price_band_low: float
    price_band_high: float
    currency: str
    next_step: NextStep
    sla_class: str
    security_class: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "offer_id": self.offer_id,
            "product_class": self.product_class,
            "product_description": self.product_description,
            "requirements": self.requirements.to_dict(),
            "estimated_monthly_price": self.estimated_monthly_price,
            "price_band_low": self.price_band_low,
            "price_band_high": self.price_band_high,
            "currency": self.currency,
            "next_step": self.next_step.value,
            "sla_class": self.sla_class,
            "security_class": self.security_class,
        }


@dataclass(frozen=True)
class FrontDeskResult:
    """What MARKOFF produces. The offer is safe to send to the client; the
    estimate stays internal and is kept separate so handing one to a client
    cannot accidentally hand over the other."""

    offer: PublicOffer
    internal_estimate: Estimate


class MarkoffFrontDesk:
    def __init__(
        self,
        estimator: KamEstimator | None = None,
        trial_ceiling: float = 500.0,
        buy_floor: float = 5_000.0,
    ) -> None:
        self._estimator = estimator or KamEstimator()
        self._trial_ceiling = trial_ceiling
        self._buy_floor = buy_floor

    def offer(
        self,
        project: ProjectInput,
        provider: Provider,
        sla_class: str = "standard",
        security_class: str = "standard",
    ) -> FrontDeskResult:
        estimate = self._estimator.estimate(project, provider)
        product = classify(project.capability, estimate.requirements)

        offer = PublicOffer(
            offer_id=uuid.uuid4().hex,
            product_class=product.code if product else "CUSTOM",
            product_description=product.description if product else "custom sizing",
            requirements=estimate.requirements,
            estimated_monthly_price=estimate.budget["expected"],
            price_band_low=estimate.budget["low"],
            price_band_high=estimate.budget["high"],
            currency=self._estimator.currency,
            next_step=self._next_step(estimate, product),
            sla_class=sla_class,
            security_class=security_class,
        )
        return FrontDeskResult(offer=offer, internal_estimate=estimate)

    def _next_step(self, estimate: Estimate, product: ProductClass | None) -> NextStep:
        # Anything we cannot size confidently goes to a human rather than being
        # given a number the sales gate would then have to walk back.
        if estimate.unserviceable or product is None:
            return NextStep.TALK_TO_KAM
        if estimate.recommendation == "kam_review":
            return NextStep.TALK_TO_KAM

        expected = estimate.budget["expected"]
        if expected >= self._buy_floor:
            return NextStep.BUY
        if expected <= self._trial_ceiling:
            return NextStep.TRIAL
        return NextStep.LEASE
