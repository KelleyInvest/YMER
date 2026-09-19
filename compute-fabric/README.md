# compute-fabric

P0 scaffold for the BASE Compute Fabric (see `BASE COMPUTE FABRIC v0.2` spec).
No live provider integrations yet — schemas and interfaces only.

## Modules

| Module | Purpose |
|---|---|
| `schema/` | `ComputeUnit`, `Job` — typed, validated, JSON-serializable |
| `providers/` | `Provider` ABC + `LocalProvider` in-process stub |
| `registry/` | `CapabilityRegistry` — provider/capability lookup |
| `costing/` | `CostLedger` — atomic per-job cost records |
| `meter/` | `Meter` — atomic per-job usage records |
| `evidence/` | `EvidenceLedger` — append-only atomic event log; `_atomic.py` write-then-rename helper |

## Status

- **P0** (this scaffold): registry, schemas, provider abstraction, cost ledger, meter, evidence ledger — done.
- **P1**: real CPU/llama.cpp/HF providers, KAM estimator, quote generator — not started.
- **P2**: GPU lease, MRR hashrate, Render, RTM idle-compute adapters — not started.
- **P3**: MARKOFF front end, self-service checkout, contracts, CRM — not started.
- **P4**: settlement (SOL, FREE, supplier rewards, treasury) — not started.

## Running tests

```bash
python3 -m pytest compute-fabric/tests/ -v
```
