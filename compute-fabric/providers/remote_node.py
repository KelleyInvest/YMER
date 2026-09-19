"""Remote node CPU provider (spec section 11, P1 item 1, remote half).

Dispatches jobs to a BASE node over SSH.

This adapter is deliberately not built on the existing node link. The installed
read-only status channel pins a forced `command="/usr/bin/cat <one status file>"`
authorization, restricts the source address, and states that remote task
execution stays disabled. Job dispatch is exactly the capability that channel
was built to withhold, so it needs its own key, its own forced remote command
and its own authorization decision. Widening the read-only key would silently
remove a control that was put there on purpose.

Two guards make that structural rather than advisory: the adapter ships
disabled, and it refuses a key whose name matches the read-only status key.

UNVERIFIED: not exercised against a live node. The remote side must expose the
configured runner command before this is enabled.
"""
from __future__ import annotations

import json
import subprocess
import uuid
from pathlib import Path

from providers.base import JobHandle, Provider
from schema.capability import Capability
from schema.compute_unit import ComputeUnit
from schema.job import Job

READONLY_STATUS_KEY_STEM = "basecloud_prod_ram_01_status_v1"


class RemoteNodeProvider(Provider):
    provider_id = "remote-node"
    lane = frozenset({Capability.CPU})
    enabled = False

    def __init__(
        self,
        host: str,
        ssh_key: Path,
        known_hosts: Path,
        runner_command: str,
        capacity: ComputeUnit | None = None,
        cost_per_unit: float = 0.0,
        timeout_seconds: float = 300.0,
        enabled: bool = False,
    ) -> None:
        key = Path(ssh_key)
        if READONLY_STATUS_KEY_STEM in key.name:
            raise ValueError(
                "refusing to dispatch jobs with the read-only status key: job dispatch "
                "requires a separate key and a separate authorization on the node"
            )
        self._host = host
        self._key = key
        self._known_hosts = Path(known_hosts)
        self._runner_command = runner_command
        self._capacity = capacity or ComputeUnit(cpu=8, ram=32)
        self._cost_per_unit = cost_per_unit
        self._timeout = timeout_seconds
        self.enabled = enabled
        self._results: dict[str, subprocess.CompletedProcess] = {}

    def capabilities(self) -> dict[Capability, ComputeUnit]:
        return {Capability.CPU: self._capacity}

    def ssh_argv(self) -> list[str]:
        """Host key pinned to our own known_hosts, no agent, no password fallback."""
        return [
            "/usr/bin/ssh",
            "-F",
            "/dev/null",
            "-T",
            "-i",
            str(self._key),
            "-o",
            "BatchMode=yes",
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            f"UserKnownHostsFile={self._known_hosts}",
            "-o",
            "GlobalKnownHostsFile=/dev/null",
            "-o",
            f"ConnectTimeout={int(self._timeout)}",
            self._host,
            self._runner_command,
        ]

    def submit(self, job: Job) -> JobHandle:
        if not self.enabled:
            raise RuntimeError(
                f"{self.provider_id} is disabled; enable it only once the node carries a "
                "dedicated job-dispatch authorization separate from the read-only status key"
            )
        if not job.requirements.fits_within(self._capacity):
            raise ValueError(f"job {job.id} exceeds {self.provider_id} capacity")

        # The payload crosses to the node as JSON on stdin, never as argv or shell text.
        spec = json.dumps({"job_id": job.id, "payload": job.payload})
        completed = subprocess.run(
            self.ssh_argv(),
            input=spec,
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
        return self._cost_per_unit * (job.requirements.cpu + job.requirements.ram)

    def _result_for(self, handle: JobHandle) -> subprocess.CompletedProcess:
        if handle.provider_id != self.provider_id:
            raise ValueError("handle does not belong to this provider")
        try:
            return self._results[handle.provider_job_id]
        except KeyError as exc:
            raise ValueError(f"unknown job handle: {handle.provider_job_id}") from exc
