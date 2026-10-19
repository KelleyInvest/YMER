"""MiningRigRentals hashrate adapter (spec section 11, P2 item 2).

Spec section 6 is emphatic that MRR is a HASHRATE lane and not a generic GPU,
render or AI lane, so `lane` is a single capability and the registry rejects
anything else this adapter might advertise.

Two independent gates, because MRR's broker policy carries a commercial
precondition as well as a technical one: brokers may source, price, route and
resell third-party hashrate, but upstream providers must be accurately informed
how their hashrate can be used. `enabled` covers "we wired it up";
`business_use_confirmed` covers "we completed that disclosure". Neither implies
the other, so neither alone opens the adapter.

The published ceiling is 100 requests/minute/IP for private calls, enforced here
rather than discovered through upstream 429s.

UNVERIFIED: not exercised against the live API. Confirm the signing scheme and
endpoint shape against current MRR documentation before enabling.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Callable

from providers.base import JobHandle, Provider
from providers.rate_limit import RateLimiter
from schema.capability import Capability
from schema.compute_unit import ComputeUnit
from schema.job import Job

DEFAULT_BASE_URL = "https://www.miningrigrentals.com/api/v2"
RATE_LIMIT_CALLS = 100
RATE_LIMIT_WINDOW_SECONDS = 60.0


class MrrProvider(Provider):
    provider_id = "mrr"
    lane = frozenset({Capability.HASHRATE})
    enabled = False

    def __init__(
        self,
        key: str,
        secret_provider: Callable[[], str],
        capacity: ComputeUnit | None = None,
        base_url: str = DEFAULT_BASE_URL,
        cost_per_call: float = 0.0,
        timeout_seconds: float = 30.0,
        enabled: bool = False,
        business_use_confirmed: bool = False,
        limiter: RateLimiter | None = None,
    ) -> None:
        if not key:
            raise ValueError("an API key is required")
        if not base_url.startswith("https://"):
            raise ValueError("base_url must be https")
        self._key = key
        self._secret_provider = secret_provider
        self._base_url = base_url.rstrip("/")
        self._capacity = capacity or ComputeUnit()
        self._cost_per_call = cost_per_call
        self._timeout = timeout_seconds
        self.enabled = enabled
        self.business_use_confirmed = business_use_confirmed
        self._limiter = limiter or RateLimiter(RATE_LIMIT_CALLS, RATE_LIMIT_WINDOW_SECONDS)
        self._results: dict[str, str] = {}

    def capabilities(self) -> dict[Capability, ComputeUnit]:
        return {Capability.HASHRATE: self._capacity}

    def _signature(self, method: str, nonce: str) -> str:
        """HMAC-SHA1 over nonce + key + method, per MRR's documented scheme."""
        message = (nonce + self._key + method).encode()
        return hmac.new(self._secret_provider().encode(), message, hashlib.sha1).hexdigest()

    def _call(self, method: str, params: dict[str, Any]) -> str:
        self._limiter.acquire()
        nonce = str(int(time.time() * 1000))
        request = urllib.request.Request(
            f"{self._base_url}/{urllib.parse.quote(method)}",
            data=json.dumps(params).encode(),
            headers={
                "x-api-key": self._key,
                "x-api-sign": self._signature(method, nonce),
                "x-api-nonce": nonce,
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                return response.read().decode()
        except urllib.error.HTTPError as exc:
            # The body can restate signed request headers; report the status only.
            raise RuntimeError(f"{self.provider_id} returned HTTP {exc.code}") from None

    def submit(self, job: Job) -> JobHandle:
        if not self.enabled:
            raise RuntimeError(f"{self.provider_id} is disabled")
        if not self.business_use_confirmed:
            raise RuntimeError(
                f"{self.provider_id} requires business-use confirmation: upstream providers "
                "must be accurately informed how their hashrate is used before resale"
            )

        rig = job.payload.get("rig_id")
        if not isinstance(rig, (str, int)) or isinstance(rig, bool):
            raise ValueError(f"payload rig_id must be a string or int: {rig!r}")

        hours = job.payload.get("hours")
        if not isinstance(hours, (int, float)) or isinstance(hours, bool) or hours <= 0:
            raise ValueError("payload hours must be a positive number")

        body = self._call("rental", {"rig": str(rig), "length": hours})
        provider_job_id = uuid.uuid4().hex
        self._results[provider_job_id] = body
        return JobHandle(provider_id=self.provider_id, provider_job_id=provider_job_id)

    def status(self, handle: JobHandle) -> str:
        return "complete" if handle.provider_job_id in self._results else "unknown"

    def output(self, handle: JobHandle) -> str:
        if handle.provider_id != self.provider_id:
            raise ValueError("handle does not belong to this provider")
        try:
            return self._results[handle.provider_job_id]
        except KeyError as exc:
            raise ValueError(f"unknown job handle: {handle.provider_job_id}") from exc

    def cost_estimate(self, job: Job) -> float:
        return self._cost_per_call
