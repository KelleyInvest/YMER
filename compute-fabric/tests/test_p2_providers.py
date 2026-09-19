"""MRR and GPU-lease adapters reach backends this repository cannot call, so
these cover the gates, the lane rules, the rate ceiling and payload validation."""
import pytest

from providers.gpu_lease import GpuLeaseProvider
from providers.mrr import RATE_LIMIT_CALLS, MrrProvider
from providers.rate_limit import RateLimiter, RateLimitExceeded
from registry.registry import CapabilityRegistry
from schema.capability import Capability
from schema.compute_unit import ComputeUnit
from schema.job import Job


def make_mrr(**overrides):
    defaults = dict(key="k", secret_provider=lambda: "s")
    defaults.update(overrides)
    return MrrProvider(**defaults)


def make_gpu(**overrides):
    defaults = dict(
        provider_id="gpu-lease",
        capability=Capability.GPU,
        base_url="https://gpu.example/api",
        token_provider=lambda: "t",
        capacity=ComputeUnit(gpu=4, vram=96),
    )
    defaults.update(overrides)
    return GpuLeaseProvider(**defaults)


def hashrate_job(**payload):
    return Job(requirements=ComputeUnit(), capability=Capability.HASHRATE, payload=payload)


def gpu_job(capability=Capability.GPU, gpu=1, **payload):
    return Job(
        requirements=ComputeUnit(gpu=gpu, vram=24), capability=capability, payload=payload
    )


# --- MRR gates -------------------------------------------------------------


def test_mrr_needs_both_gates():
    """enabled and business_use_confirmed are independent; neither alone opens it."""
    job = hashrate_job(rig_id="1", hours=2)

    with pytest.raises(RuntimeError, match="disabled"):
        make_mrr().submit(job)
    with pytest.raises(RuntimeError, match="business-use confirmation"):
        make_mrr(enabled=True).submit(job)
    with pytest.raises(RuntimeError, match="disabled"):
        make_mrr(business_use_confirmed=True).submit(job)


def test_mrr_serves_only_the_hashrate_lane():
    """Spec section 6: MRR is not a generic GPU/render/AI lane."""
    assert make_mrr().lane == frozenset({Capability.HASHRATE})
    assert set(make_mrr().capabilities()) == {Capability.HASHRATE}


def test_mrr_registers_only_under_hashrate():
    registry = CapabilityRegistry()
    registry.register(make_mrr(enabled=True, business_use_confirmed=True))
    for lane in (Capability.GPU, Capability.RENDER, Capability.INFERENCE, Capability.CPU):
        assert registry.providers_for(lane) == []


@pytest.mark.parametrize(
    "payload",
    [
        {"hours": 2},
        {"rig_id": "1"},
        {"rig_id": True, "hours": 2},
        {"rig_id": "1", "hours": 0},
        {"rig_id": "1", "hours": -1},
        {"rig_id": ["1"], "hours": 2},
    ],
)
def test_mrr_rejects_malformed_payload_before_calling_upstream(payload):
    provider = make_mrr(enabled=True, business_use_confirmed=True)
    with pytest.raises(ValueError):
        provider.submit(hashrate_job(**payload))


def test_mrr_requires_https():
    with pytest.raises(ValueError):
        make_mrr(base_url="http://www.miningrigrentals.com/api/v2")


def test_mrr_signature_changes_with_nonce_and_method():
    provider = make_mrr()
    assert provider._signature("rental", "1") != provider._signature("rental", "2")
    assert provider._signature("rental", "1") != provider._signature("whoami", "1")


def test_mrr_does_not_hold_the_secret():
    provider = make_mrr(secret_provider=lambda: "super-secret")
    assert "super-secret" not in repr(provider)
    assert "super-secret" not in str(vars(provider))


# --- rate limiting ---------------------------------------------------------


def test_limiter_blocks_past_the_ceiling():
    now = [0.0]
    limiter = RateLimiter(max_calls=3, per_seconds=60, clock=lambda: now[0])
    for _ in range(3):
        limiter.acquire()
    with pytest.raises(RateLimitExceeded):
        limiter.acquire()


def test_limiter_window_slides():
    now = [0.0]
    limiter = RateLimiter(max_calls=2, per_seconds=60, clock=lambda: now[0])
    limiter.acquire()
    limiter.acquire()
    with pytest.raises(RateLimitExceeded):
        limiter.acquire()

    now[0] = 61.0
    limiter.acquire()  # the earlier calls have aged out


def test_mrr_enforces_the_documented_ceiling_before_sending():
    """The 100/min ceiling is enforced locally, not discovered via upstream 429s."""
    now = [0.0]
    provider = make_mrr(
        enabled=True,
        business_use_confirmed=True,
        limiter=RateLimiter(RATE_LIMIT_CALLS, 60.0, clock=lambda: now[0]),
    )
    for _ in range(RATE_LIMIT_CALLS):
        provider._limiter.acquire()

    with pytest.raises(RateLimitExceeded):
        provider.submit(hashrate_job(rig_id="1", hours=1))


# --- GPU lease -------------------------------------------------------------


def test_gpu_lease_is_disabled_by_default():
    with pytest.raises(RuntimeError, match="disabled"):
        make_gpu().submit(gpu_job(workload_ref="scene-1"))


def test_gpu_lease_serves_render_lane_too():
    provider = make_gpu(provider_id="render-lease", capability=Capability.RENDER)
    assert provider.lane == frozenset({Capability.RENDER})
    assert set(provider.capabilities()) == {Capability.RENDER}


def test_gpu_lease_rejects_a_non_gpu_lane():
    """It brokers GPU capacity; it must not be configurable into the CPU or
    hashrate lanes."""
    for lane in (Capability.CPU, Capability.HASHRATE, Capability.INFERENCE):
        with pytest.raises(ValueError, match="not a leasable GPU lane"):
            make_gpu(capability=lane)


def test_gpu_lease_requires_https():
    with pytest.raises(ValueError):
        make_gpu(base_url="http://gpu.example/api")


def test_gpu_lease_rejects_oversized_and_malformed_jobs():
    provider = make_gpu(enabled=True)
    with pytest.raises(ValueError):
        provider.submit(gpu_job(gpu=99, workload_ref="scene-1"))
    for bad in [None, "", ["scene-1"]]:
        with pytest.raises(ValueError):
            provider.submit(gpu_job(workload_ref=bad))


def test_gpu_lease_does_not_hold_the_token():
    provider = make_gpu(token_provider=lambda: "super-secret")
    assert "super-secret" not in repr(provider)
    assert "super-secret" not in str(vars(provider))
