# compute-fabric

P0 scaffold for the BASE Compute Fabric (see `BASE COMPUTE FABRIC v0.2` spec).
No live provider integrations yet — schemas and interfaces only.

## Modules

| Module | Purpose |
|---|---|
| `schema/` | `ComputeUnit`, `Job` — typed, validated, JSON-serializable |
| `providers/` | `Provider` ABC + `LocalProvider` in-process stub |
| `registry/` | `CapabilityRegistry` — provider/capability lookup |
| `costing/` | `CostLedger` — append-only atomic cost records per job |
| `meter/` | `Meter` — append-only atomic usage records per job |
| `evidence/` | `EvidenceLedger` — append-only atomic event log; `_atomic.py` write-then-rename helper |

## Status

- **P0** (this scaffold): registry, schemas, provider abstraction, cost ledger, meter, evidence ledger — done.
- **P1**: real CPU/llama.cpp/HF providers, KAM estimator, quote generator — not started.
- **P2**: GPU lease, MRR hashrate, Render, RTM idle-compute adapters — not started.
- **P3**: MARKOFF front end, self-service checkout, contracts, CRM — not started.
- **P4**: settlement (SOL, FREE, supplier rewards, treasury) — not started.

## Running tests

```bash
python3 -m pytest        # from the repo root; see pytest.ini
```

## Conventions

- Job ids become ledger directory names, so they are restricted to
  `[A-Za-z0-9_-]{1,128}` (`schema/job.py:validate_job_id`). Anything reading
  a job id from outside the fabric must pass it through that check.
- Cost and meter records are append-only: `record_*` never overwrites, and
  `history()` returns every record while `get_*` returns the latest.
