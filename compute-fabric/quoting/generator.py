"""Automatic quote generator (spec section 11, P1 item 5).

Composes a client price from an upstream cost using the configured PricingPolicy
and emits the internal and public views of it.
"""
from __future__ import annotations

import uuid

from providers.base import Provider
from quoting.policy import PricingPolicy
from quoting.quote import InternalQuote, PublicQuote
from schema.job import Job


class QuoteGenerator:
    def __init__(self, policy: PricingPolicy | None = None) -> None:
        self._policy = policy or PricingPolicy()

    @property
    def policy(self) -> PricingPolicy:
        return self._policy

    def quote(
        self,
        job: Job,
        provider: Provider,
        delivery_target_seconds: float,
        sla_class: str = "standard",
        security_class: str = "standard",
    ) -> InternalQuote:
        upstream_cost = provider.cost_estimate(job)
        if upstream_cost < 0:
            raise ValueError(f"{provider.provider_id} returned a negative cost estimate")

        policy = self._policy
        public = PublicQuote(
            quote_id=uuid.uuid4().hex,
            capability=job.capability,
            requirements=job.requirements,
            client_price=round(upstream_cost * (1 + policy.total_uplift), 6),
            currency=policy.currency,
            delivery_target_seconds=delivery_target_seconds,
            sla_class=sla_class,
            security_class=security_class,
        )
        return InternalQuote(
            public=public,
            provider_id=provider.provider_id,
            upstream_cost=upstream_cost,
            supplier_share=round(upstream_cost * policy.supplier_share, 6),
            kam_acquisition=round(upstream_cost * policy.kam_acquisition, 6),
            reserve=round(upstream_cost * policy.reserve, 6),
            free_rewards=round(upstream_cost * policy.free_rewards, 6),
            base_margin=round(upstream_cost * policy.base_margin, 6),
        )
