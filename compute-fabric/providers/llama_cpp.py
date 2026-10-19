"""llama.cpp provider (spec section 11, P1 item 2).

Runs inference against a local llama.cpp binary over models kept in the fabric's
models/ directory.

Two client-supplied values are treated as hostile. The model name selects from
an operator-registered allowlist and is never joined onto a path, so a payload
cannot reach a file outside models/. The prompt is passed as a single argv
element to a binary invoked without a shell, so it cannot become a command.
"""
from __future__ import annotations

import subprocess
import uuid
from pathlib import Path

from providers.base import JobHandle, Provider
from schema.capability import Capability
from schema.compute_unit import ComputeUnit
from schema.job import Job


class LlamaCppProvider(Provider):
    provider_id = "llama-cpp"
    lane = frozenset({Capability.INFERENCE})

    def __init__(
        self,
        binary: Path,
        models: dict[str, Path],
        capacity: ComputeUnit | None = None,
        cost_per_unit: float = 0.0,
        timeout_seconds: float = 300.0,
    ) -> None:
        if not models:
            raise ValueError("at least one model must be registered")
        self._binary = Path(binary)
        self._models = {name: Path(path) for name, path in models.items()}
        self._capacity = capacity or ComputeUnit(cpu=8, ram=32)
        self._cost_per_unit = cost_per_unit
        self._timeout = timeout_seconds
        self._results: dict[str, subprocess.CompletedProcess] = {}

    def capabilities(self) -> dict[Capability, ComputeUnit]:
        return {Capability.INFERENCE: self._capacity}

    def submit(self, job: Job) -> JobHandle:
        if not job.requirements.fits_within(self._capacity):
            raise ValueError(f"job {job.id} exceeds {self.provider_id} capacity")

        model_name = job.payload.get("model")
        if not isinstance(model_name, str) or model_name not in self._models:
            raise ValueError(f"unregistered model: {model_name!r}")

        prompt = job.payload.get("prompt")
        if not isinstance(prompt, str) or not prompt:
            raise ValueError("payload prompt must be a non-empty string")

        max_tokens = job.payload.get("max_tokens", 256)
        if not isinstance(max_tokens, int) or isinstance(max_tokens, bool) or max_tokens < 1:
            raise ValueError("payload max_tokens must be a positive int")

        # No shell: argv list, fixed binary, allowlisted model path, prompt as one element.
        completed = subprocess.run(
            [
                str(self._binary),
                "-m",
                str(self._models[model_name]),
                "-n",
                str(max_tokens),
                "-p",
                prompt,
            ],
            capture_output=True,
            text=True,
            timeout=self._timeout,
            check=False,
        )
        provider_job_id = uuid.uuid4().hex
        self._results[provider_job_id] = completed
        return JobHandle(provider_id=self.provider_id, provider_job_id=provider_job_id)

    def status(self, handle: JobHandle) -> str:
        return "complete" if self._result_for(handle).returncode == 0 else "failed"

    def output(self, handle: JobHandle) -> str:
        return self._result_for(handle).stdout

    def cost_estimate(self, job: Job) -> float:
        return self._cost_per_unit * job.payload.get("max_tokens", 256)

    def _result_for(self, handle: JobHandle) -> subprocess.CompletedProcess:
        if handle.provider_id != self.provider_id:
            raise ValueError("handle does not belong to this provider")
        try:
            return self._results[handle.provider_job_id]
        except KeyError as exc:
            raise ValueError(f"unknown job handle: {handle.provider_job_id}") from exc
