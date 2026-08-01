---
name: performance-and-streaming
description: Use this skill when improving performance, memory use, streaming architecture, large-project indexing, codemod throughput, watch-mode responsiveness, or performance test failures.
---

# Performance And Streaming Skill

## Purpose

Use this skill when an agent is addressing runtime performance, memory growth, large-project throughput, or performance tests.

The performance target state is structural efficiency:

- bounded memory for large GameMaker projects
- streaming or chunked processing for project-wide workloads
- deterministic output despite internal batching or concurrency
- measured improvements rather than threshold relaxation
- reuse of proven libraries when they solve real storage, parsing, graph, or scheduling needs

Performance fixes should remove the cause of waste, not hide symptoms.

## When To Use

Use this skill for:

- semantic project indexing performance
- refactor/codemod memory or throughput
- CLI watch-mode responsiveness
- graph/search/context retrieval scale
- transpiler hot-reload latency
- repeated parser, formatter, or lint bottlenecks
- performance test failures
- unbounded caches, snapshots, arrays, maps, or overlays

## Working Approach

Before optimizing:

1. Reproduce the slow path or memory growth with the narrowest available command.
2. Identify whether the cost is CPU, memory, I/O, serialization, parsing, or dependency churn.
3. Add or update a test or benchmark that captures the issue when practical.
4. Inspect data lifetime and ownership before changing thresholds or concurrency.
5. Choose a structural fix that scales with project size.

Implementation should:

- stream records instead of retaining full-project aggregates
- chunk large workloads with deterministic merge behavior
- release intermediate structures promptly
- avoid repeated parsing, formatting, serialization, and graph construction
- use caches with explicit size, lifecycle, and invalidation
- prefer lazy queries over eager snapshots
- keep concurrency bounded and measured

## Memory Strategy

Large-project workflows should not depend on huge heap limits.

- Use temp-file chunking as the default spill strategy when it solves large aggregate retention.
- Consider SQLite or another established store only when query patterns or benchmarks justify it.
- Keep canonical domain models independent from storage backend details.
- Avoid retaining source overlays, semantic occurrences, workspace edits, and graph projections across phases unless required.
- Make cleanup deterministic for temp files, handles, watchers, and worker resources.

## CPU And I/O Strategy

Optimize repeated work first.

- Avoid reparsing files whose content and relevant options did not change.
- Avoid rebuilding whole-project indexes when an incremental path is correct.
- Batch I/O where it reduces overhead without hiding failures.
- Use stable ordering after concurrent work so outputs remain deterministic.
- Prefer efficient standard or established library algorithms over bespoke implementations for graph, search, storage, and parsing problems.

## Performance Tests

Do not relax performance criteria to make tests pass.

- Treat failing thresholds as evidence of an implementation problem unless proven stale by new requirements.
- Add targeted regression tests for fixed bottlenecks.
- Keep tests deterministic enough for CI.
- Use profiling output to guide changes, then remove noisy debug logging.
- Document benchmark assumptions in tests or code when they affect design.

## Automation And AI-Agent Workloads

Performance matters for agent workflows because agents repeatedly query, edit, and validate projects.

- Return compact context instead of unbounded payloads.
- Prefer incremental validation after small changes.
- Keep command and MCP outputs deterministic and machine-readable.
- Avoid hidden warm state that makes repeated runs diverge.

## Checklist

Before finishing performance work, verify:

1. The root cause is identified and addressed structurally.
2. Memory growth is bounded or explicitly justified.
3. Output ordering remains deterministic.
4. Performance tests were preserved or strengthened.
5. Relevant build, lint, and tests pass for code changes.
6. No broad user-facing knobs were added for internal tuning.

## Prohibited Patterns

- Raising heap size as the primary fix.
- Relaxing performance thresholds to get green tests.
- Unbounded caches or full-project snapshots without proven need.
- User-facing flags for internal execution backends.
- Duplicating established library functionality without a concrete reason.
- Dynamic imports, `require()`, `any`, or non-null assertions to bypass typing.
