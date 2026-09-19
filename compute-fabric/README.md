# compute-fabric

P0 scaffold for the BASE Compute Fabric (see `BASE COMPUTE FABRIC v0.2` spec).
No live provider integrations yet — schemas and interfaces only.

## Modules

| Module | Purpose |
|---|---|
| `schema/` | `Capability`, `Priority`, `ComputeUnit`, `Job` — typed, validated, JSON-serializable |
| `providers/` | `Provider` ABC, `LocalProvider` test double, the `local_cpu`, `llama_cpp`, `rtm_idle` local adapters, the gated `huggingface`, `remote_node`, `mrr`, `gpu_lease` adapters, and a shared `RateLimiter` |
| `registry/` | `CapabilityRegistry` — capability lookup, lane enforcement, enabled-only routing |
| `scheduler/` | `Router` (cheapest-fits selection) and `Scheduler` (priority lanes) |
| `quoting/` | `PricingPolicy`, `PublicQuote`/`InternalQuote`, `QuoteGenerator` |
| `kam/` | `KamEstimator` — project sizing, budget bands, recommendation |
| `costing/` | `CostLedger` — append-only atomic cost records per job |
| `meter/` | `Meter` — append-only atomic usage records per job |
| `evidence/` | `EvidenceLedger` — append-only atomic event log; `_atomic.py` write-then-rename helper |

## Status

- **P0** (this scaffold): registry, schemas, provider abstraction, cost ledger, meter, evidence ledger — done.
- **P1**: CPU/llama.cpp/HF/node providers, KAM estimator, quote generator — done, with two adapters gated (see below).
- **P2**: scheduler and priority lanes, RTM idle-compute, MRR hashrate, GPU/render lease — done, with the external adapters gated. A dedicated Render Network adapter is still outstanding (see below).
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
- A job payload is untrusted input. A provider must not turn it into a command
  line or a filesystem path: `local_cpu` runs only operator-registered
  workloads, and `llama_cpp` selects its model from an allowlist.
- Providers declare a `lane` and the registry rejects anything advertised
  outside it — this is how spec §6's "MRR is hashrate, not generic GPU/render/AI"
  is enforced. `lookup()` returns only `enabled` providers.
- The client/broker barrier (spec §4) is structural: `PublicQuote` has no field
  for upstream cost, margin or provider identity. Do not add one — put it on
  `InternalQuote` instead.

## Priority lanes

Spec §6 orders CPU work BASE → client → PoC → RTM/idle. `Scheduler` dispatches
in that order, FIFO within a lane, and an unroutable job is skipped rather than
left blocking the lanes beneath it. Idle-lane work never dispatches while a
higher lane is waiting, and `RtmIdleProvider` independently refuses anything
above the idle lane — RTM is a protected lane, but protected means it gets idle
capacity, not that it competes for paid capacity.

## Gated adapters

`huggingface`, `remote_node`, `mrr` and `gpu_lease` ship `enabled = False` and
are **unverified** — none has been run against its real backend.

- **`huggingface`** needs a token (`HF_API_TOKEN`, read per call, never in
  source) and its `base_url` confirmed against current HF docs. Enabling it
  means an external provider may process personal data, which requires a data
  processing agreement per spec §4.
- **`remote_node`** must not reuse the read-only status channel. That channel
  pins a forced `command="/usr/bin/cat <one status file>"` and states remote
  task execution stays disabled; job dispatch needs its own key and its own
  authorization on the node. The adapter refuses an `ssh_key` named after the
  read-only status key.
- **`mrr`** needs *two* gates: `enabled` and `business_use_confirmed`. MRR's
  broker policy permits sourcing and reselling third-party hashrate but requires
  that upstream providers be accurately informed how it is used — that
  disclosure is a separate fact from having wired the adapter up, so neither
  flag implies the other. The documented 100 req/min/IP ceiling is enforced
  locally rather than discovered through upstream 429s.
- **`gpu_lease`** is one adapter parameterised by lane (`GPU` or `RENDER`), not
  a per-vendor family. **The Render Network is not covered by it** — it has its
  own API and commercial terms and needs a dedicated adapter once we have
  access. Do not rename a `gpu_lease` instance and call it done.
