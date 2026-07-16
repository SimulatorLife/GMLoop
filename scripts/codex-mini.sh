#!/usr/bin/env bash
# Run Codex with MiniMax-M3 through the provider configured in ~/.codex/config.toml.
# The trusted project SessionStart/SubagentStart hooks ensure its proxy is ready.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"

exec codex \
  --disable memories \
  --disable multi_agent_v2 \
  --enable multi_agent \
  -c 'model="MiniMax-M3"' \
  -c 'model_provider="minimax"' \
  -c "model_catalog_json=\"~/.codex/minimax-model-catalog.json\"" \
  -c 'model_reasoning_effort="high"' \
  -c 'model_reasoning_summary="none"' \
  "$@"
