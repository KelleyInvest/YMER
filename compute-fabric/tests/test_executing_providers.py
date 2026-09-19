import subprocess
import sys

import pytest

from providers.llama_cpp import LlamaCppProvider
from providers.local_cpu import LocalCpuProvider
from schema.capability import Capability
from schema.compute_unit import ComputeUnit
from schema.job import Job


def make_job(payload, **overrides):
    defaults = dict(
        requirements=ComputeUnit(cpu=1, ram=2),
        capability=Capability.CPU,
        payload=payload,
    )
    defaults.update(overrides)
    return Job(**defaults)


def make_cpu_provider():
    return LocalCpuProvider(workloads={"double": lambda args: args["value"] * 2})


def test_local_cpu_runs_a_registered_workload():
    provider = make_cpu_provider()
    handle = provider.submit(make_job({"workload": "double", "args": {"value": 21}}))
    assert provider.result(handle, timeout=5) == 42
    assert provider.status(handle) == "complete"
    provider.shutdown()


def test_local_cpu_reports_a_failing_workload():
    def boom(args):
        raise RuntimeError("workload failed")

    provider = LocalCpuProvider(workloads={"boom": boom})
    handle = provider.submit(make_job({"workload": "boom"}))
    with pytest.raises(RuntimeError):
        provider.result(handle, timeout=5)
    assert provider.status(handle) == "failed"
    provider.shutdown()


@pytest.mark.parametrize(
    "payload",
    [
        {"workload": "nope"},
        {},
        {"workload": ["double"]},
        {"workload": "double", "args": "not-a-dict"},
    ],
)
def test_local_cpu_rejects_unregistered_or_malformed_workloads(payload):
    """The payload selects from a registry; it can never supply a command."""
    provider = make_cpu_provider()
    with pytest.raises(ValueError):
        provider.submit(make_job(payload))
    provider.shutdown()


def test_local_cpu_rejects_oversized_job():
    provider = LocalCpuProvider(
        workloads={"double": lambda args: 1}, capacity=ComputeUnit(cpu=1, ram=1)
    )
    with pytest.raises(ValueError):
        provider.submit(make_job({"workload": "double"}, requirements=ComputeUnit(cpu=99)))
    provider.shutdown()


def test_llama_cpp_runs_inference(tmp_path, monkeypatch):
    """Exercises the real subprocess path, with a Python script standing in for
    the llama.cpp binary and accepting the same argv shape."""
    fake_binary = tmp_path / "fake-llama.py"
    fake_binary.write_text("import sys\nprint('echo:' + sys.argv[-1])\n")
    model = tmp_path / "model.gguf"
    model.write_bytes(b"stub")

    provider = LlamaCppProvider(binary=sys.executable, models={"tiny": model})
    invocations = []
    real_run = subprocess.run

    def run_with_script(args, **kwargs):
        invocations.append(args)
        return real_run([sys.executable, str(fake_binary), *args[1:]], **kwargs)

    monkeypatch.setattr("providers.llama_cpp.subprocess.run", run_with_script)

    job = make_job(
        {"model": "tiny", "prompt": "hei", "max_tokens": 8}, capability=Capability.INFERENCE
    )
    handle = provider.submit(job)
    assert provider.status(handle) == "complete"
    assert "echo:hei" in provider.output(handle)

    argv = invocations[0]
    assert argv[argv.index("-m") + 1] == str(model)  # the allowlisted path, not payload text
    assert "hei" in argv  # prompt is one argv element, never a shell fragment


def test_llama_cpp_rejects_unregistered_model(tmp_path):
    """A model name outside the allowlist must not become a filesystem path."""
    model = tmp_path / "model.gguf"
    model.write_bytes(b"stub")
    provider = LlamaCppProvider(binary=sys.executable, models={"tiny": model})

    for bad in ["../../etc/passwd", "/etc/passwd", "unknown", None, ["tiny"]]:
        with pytest.raises(ValueError):
            provider.submit(
                make_job({"model": bad, "prompt": "hei"}, capability=Capability.INFERENCE)
            )


def test_llama_cpp_rejects_malformed_prompt_and_tokens(tmp_path):
    model = tmp_path / "model.gguf"
    model.write_bytes(b"stub")
    provider = LlamaCppProvider(binary=sys.executable, models={"tiny": model})

    with pytest.raises(ValueError):
        provider.submit(make_job({"model": "tiny", "prompt": ""}, capability=Capability.INFERENCE))
    with pytest.raises(ValueError):
        provider.submit(
            make_job(
                {"model": "tiny", "prompt": "hei", "max_tokens": 0},
                capability=Capability.INFERENCE,
            )
        )
