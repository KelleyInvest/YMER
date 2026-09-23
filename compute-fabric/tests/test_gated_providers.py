"""The HF and remote-node adapters cannot be exercised against their real
backends here, so these tests cover the gates: the enable flag, the allowlists,
and the refusal to reuse the read-only status key."""
import pytest

from providers.huggingface import HuggingFaceProvider
from providers.remote_node import READONLY_STATUS_KEY_STEM, RemoteNodeProvider
from registry.registry import CapabilityRegistry
from schema.capability import Capability
from schema.compute_unit import ComputeUnit
from schema.job import Job


def make_hf(**overrides):
    defaults = dict(models={"tiny-model"}, token_provider=lambda: "token")
    defaults.update(overrides)
    return HuggingFaceProvider(**defaults)


def make_node(tmp_path, **overrides):
    defaults = dict(
        host="baseadmin@example",
        ssh_key=tmp_path / "dispatch_key",
        known_hosts=tmp_path / "known_hosts",
        runner_command="/usr/bin/base-job-runner",
    )
    defaults.update(overrides)
    return RemoteNodeProvider(**defaults)


def inference_job(payload):
    return Job(
        requirements=ComputeUnit(), capability=Capability.INFERENCE, payload=payload
    )


def test_hf_is_disabled_by_default():
    with pytest.raises(RuntimeError, match="disabled"):
        make_hf().submit(inference_job({"model": "tiny-model", "inputs": "hei"}))


def test_hf_rejects_model_outside_allowlist():
    provider = make_hf(enabled=True)
    for bad in ["other-model", "", None, ["tiny-model"]]:
        with pytest.raises(ValueError):
            provider.submit(inference_job({"model": bad, "inputs": "hei"}))


def test_hf_requires_https_base_url():
    with pytest.raises(ValueError):
        make_hf(base_url="http://api-inference.huggingface.co/models")


def test_hf_does_not_hold_the_token():
    """The token is fetched per call, so it is not reachable from the object."""
    provider = make_hf(token_provider=lambda: "super-secret")
    assert "super-secret" not in repr(provider)
    assert "super-secret" not in str(vars(provider))


def test_node_refuses_the_readonly_status_key(tmp_path):
    """Job dispatch must not reuse the key whose authorization forces a
    read-only cat of one status file."""
    with pytest.raises(ValueError, match="read-only status key"):
        make_node(tmp_path, ssh_key=tmp_path / f"{READONLY_STATUS_KEY_STEM}")


def test_node_is_disabled_by_default(tmp_path):
    job = Job(requirements=ComputeUnit(cpu=1), capability=Capability.CPU)
    with pytest.raises(RuntimeError, match="disabled"):
        make_node(tmp_path).submit(job)


def test_node_ssh_argv_pins_host_key_and_avoids_shell(tmp_path):
    argv = make_node(tmp_path, enabled=True).ssh_argv()
    assert "StrictHostKeyChecking=yes" in argv
    assert "BatchMode=yes" in argv
    assert "IdentitiesOnly=yes" in argv
    assert argv[-1] == "/usr/bin/base-job-runner"


def test_disabled_provider_is_never_selected_by_lookup(tmp_path):
    """A gated provider still registers, but must not be routable until enabled."""
    registry = CapabilityRegistry()
    registry.register(make_node(tmp_path))
    assert registry.lookup(Capability.CPU, ComputeUnit(cpu=1)) == []


def test_enabled_provider_is_selected(tmp_path):
    registry = CapabilityRegistry()
    provider = make_node(tmp_path, enabled=True)
    registry.register(provider)
    assert registry.lookup(Capability.CPU, ComputeUnit(cpu=1)) == [provider]


def test_registry_rejects_a_provider_advertising_outside_its_lane(tmp_path):
    """Spec section 6: an adapter cannot advertise itself into another lane."""

    class StrayHashrateProvider(RemoteNodeProvider):
        provider_id = "stray"
        lane = frozenset({Capability.HASHRATE})

    registry = CapabilityRegistry()
    with pytest.raises(ValueError, match="outside its lane"):
        registry.register(StrayHashrateProvider(
            host="h",
            ssh_key=tmp_path / "k",
            known_hosts=tmp_path / "kh",
            runner_command="/usr/bin/runner",
        ))
