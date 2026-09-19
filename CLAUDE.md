# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**YMER** - The Giant and the old Mother Cow

This repository hosts the **BASE Compute Fabric** (v0.2): a broker that routes client compute jobs (CPU, GPU, specialist) through self-service and human-expert entry points to internal and external compute providers, with cost/usage/evidence ledgers underneath. See `compute-fabric/README.md` for the module map and build-order status (P0–P4).

## Repository Structure

```
YMER/
├── README.md              # Project overview
├── CLAUDE.md              # This file - guidance for Claude Code
├── compute-fabric/        # BASE Compute Fabric P0 scaffold
│   ├── schema/             # ComputeUnit, Job dataclasses
│   ├── providers/          # Provider ABC + LocalProvider stub
│   ├── registry/           # CapabilityRegistry
│   ├── costing/            # CostLedger (atomic per-job cost records)
│   ├── meter/               # Meter (atomic per-job usage records)
│   ├── evidence/            # EvidenceLedger + atomic write helper
│   ├── tests/               # pytest suite for all of the above
│   └── README.md
└── .git/                  # Git repository metadata
```

As the project evolves (P1: real providers/KAM estimator, P2: GPU/MRR/Render adapters, P3: MARKOFF front end, P4: settlement), this structure will expand accordingly.

## Git Workflow

### Branches

- **main**: The production/stable branch. Code merged here should be tested and ready for release.
- **claude/\***: Feature branches for specific development tasks, prefixed with `claude/` for AI-assisted work.

### Development Process

1. Work is performed on feature branches (e.g., `claude/claude-md-docs-2pyvr0`)
2. Changes are committed with clear, descriptive messages
3. All work is pushed to the feature branch, not directly to `main`
4. Pull requests are created for code review before merging to `main`
5. After pushing changes, automatically create a draft PR if one doesn't already exist

### Commit Message Style

Commit messages should be clear and concise:
- First line: brief summary (imperative mood, under 70 characters)
- Optional body: explanation of why the change was made
- Example: "Add project initialization scaffold" or "Update README with setup instructions"

## Development Setup

- **Language**: Python 3.11+ (standard library only for P0; no external runtime dependencies).
- **Test dependency**: `pytest` (`pip install pytest`).
- **Run tests**: `python3 -m pytest compute-fabric/tests/ -v` from the repo root.
- No build step; modules under `compute-fabric/` are imported directly (tests add the `compute-fabric/` directory to `sys.path` via `conftest.py`, since it's a hyphenated directory name, not an importable package).

## Code Conventions

As code is added to this project, the following conventions should be followed:

- **Language/Framework**: To be determined based on project requirements
- **Code Style**: Will be documented once the tech stack is chosen
- **Testing**: All new features should include appropriate tests (unit, integration, or end-to-end as applicable)
- **Documentation**: Code should be self-documenting with clear function/class names; add comments only for non-obvious logic
- **File Organization**: Group related code by feature or domain; avoid premature abstraction

## Key Conventions for AI Assistants

When working on this repository:

1. **Before making changes**: Understand the existing structure and read any relevant documentation
2. **Type safety**: If using a typed language, maintain type safety throughout
3. **Testing**: Run tests before committing; add new tests for new functionality
4. **No breaking changes**: Avoid refactoring that changes public APIs without discussion
5. **Clear commits**: Create logical, reviewable commits with one concept per commit
6. **PR etiquette**: Keep PRs focused on a single feature or fix; reference relevant issues when creating PRs

## When the Project Evolves

Once the project has actual code, this CLAUDE.md should be updated with:

- Architecture diagrams or descriptions of how components interact
- How to run the application locally
- Build and test commands
- Any project-specific conventions or patterns
- Configuration file locations and what each configures
- Database schema (if applicable) and migration procedures
- Performance considerations or optimization notes
- Security considerations for the project domain

## Useful Resources

- **Repository**: https://github.com/KelleyInvest/YMER
- **Issue Tracker**: Available through GitHub (when issues are created)

## Questions or Issues?

If you're an AI assistant working on this project and need clarification on any conventions or structure:
- Check this CLAUDE.md first
- Review existing commits to understand patterns
- Refer to the README.md for project context
- Look at any issue descriptions for task-specific context
