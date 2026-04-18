#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/qwen-local-smoke.sh [--mock-agent] [--model MODEL] [--workspace PATH]

Runs the qwen-local preflight outside GitHub Actions.

Default mode mirrors the qwen-local workflow bootstrap:
  1. Install Qwen Code if qwen is missing.
  2. Install Ollama if ollama is missing.
  3. Start Ollama if its local API is not already running.
  4. Pull the selected model.
  5. Verify native and OpenAI-compatible Ollama APIs.
  6. Verify Qwen Code exposes required native tools to the selected model.
  7. Verify Qwen Code can call shell tools through the selected model.
  8. Verify Qwen Code can edit a scratch TypeScript file.

The checks prove:
  1. Ollama native API is reachable.
  2. Ollama OpenAI-compatible API is reachable.
  3. The selected model can answer a small chat request.
  4. Qwen Code sends native tool declarations to the model.
  5. Qwen Code can call tools through the selected model.
  6. Qwen Code can use tools to edit a scratch TypeScript file.

--mock-agent skips Ollama/Qwen and applies the scratch code edit directly.
This is useful on machines without Ollama while still checking the local
workspace/edit validation path.

Environment:
  QWEN_CODE_PACKAGE           Qwen Code package to install when qwen is missing.
  QWEN_LOCAL_MODEL             Default model, overridden by --model.
  QWEN_LOCAL_SMOKE_WORKSPACE   Scratch workspace path, overridden by --workspace.
  QWEN_MAX_SESSION_TURNS       Qwen max turns for the real smoke run.
  QWEN_TOOL_SMOKE_TURNS        Qwen max turns for the tool-call smoke gate.
USAGE
}

repo_root="$(git rev-parse --show-toplevel)"
mode="real"
qwen_code_package="${QWEN_CODE_PACKAGE:-@qwen-code/qwen-code@0.14.5}"
model="${QWEN_LOCAL_MODEL:-qwen3:1.7b}"
smoke_workspace="${QWEN_LOCAL_SMOKE_WORKSPACE:-${repo_root}/tmp/qwen-local-smoke-workspace}"
max_session_turns="${QWEN_MAX_SESSION_TURNS:-40}"
tool_smoke_turns="${QWEN_TOOL_SMOKE_TURNS:-6}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --mock-agent)
      mode="mock"
      shift
      ;;
    --model)
      model="${2:?--model requires a value}"
      shift 2
      ;;
    --workspace)
      smoke_workspace="${2:?--workspace requires a value}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

openai_api_key="ollama"
openai_base_url="http://127.0.0.1:11434/v1"
smoke_file="${smoke_workspace}/src/qwen-local-smoke.ts"
ollama_log="${smoke_workspace}/ollama.log"
tool_smoke_file="${RUNNER_TEMP:-/tmp}/qwen-local-tool-smoke.txt"
started_ollama_pid=""

export NO_PROXY="${NO_PROXY:+${NO_PROXY},}127.0.0.1,localhost"
export no_proxy="${no_proxy:+${no_proxy},}127.0.0.1,localhost"

cleanup() {
  if [ -n "${started_ollama_pid}" ]; then
    kill "${started_ollama_pid}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    return 1
  fi
}

install_qwen_if_missing() {
  local expected_version
  local installed_version

  expected_version="${qwen_code_package##*@}"

  if command -v qwen >/dev/null 2>&1 && [[ "${expected_version}" =~ ^[0-9]+[.][0-9]+[.][0-9]+$ ]]; then
    installed_version="$(qwen --version 2>/dev/null || true)"
    if [ "${installed_version}" = "${expected_version}" ]; then
      echo "qwen CLI already installed at: $(command -v qwen) (${installed_version})"
      return 0
    fi

    echo "qwen CLI version ${installed_version:-unknown} does not match ${expected_version}; installing ${qwen_code_package} via pnpm..."
  elif command -v qwen >/dev/null 2>&1; then
    echo "qwen CLI exists, but ${qwen_code_package} is not pinned to a concrete version; refreshing it via pnpm..."
  else
    echo "qwen CLI not found; installing ${qwen_code_package} via pnpm..."
  fi

  require_command pnpm
  pnpm add -g "${qwen_code_package}"

  if command -v qwen >/dev/null 2>&1; then
    echo "Installed ${qwen_code_package}. CLI location: $(command -v qwen), version: $(qwen --version 2>/dev/null || echo unknown)"
    return 0
  fi

  echo "pnpm completed but qwen is still not on PATH." >&2
  return 1
}

install_ollama_if_missing() {
  if command -v ollama >/dev/null 2>&1; then
    echo "ollama CLI already installed at: $(command -v ollama)"
    return 0
  fi

  echo "ollama CLI not found; installing Ollama with the workflow installer..."
  curl -fsSL https://ollama.com/install.sh | sh
  echo "Installed Ollama. CLI location: $(command -v ollama)"
}

curl_ollama() {
  curl --noproxy '*' -fsS "$@"
}

prepare_smoke_workspace() {
  rm -rf "${smoke_workspace}"
  mkdir -p "${smoke_workspace}/src"

  cat > "${smoke_workspace}/package.json" <<'JSON'
{
  "name": "qwen-local-smoke-workspace",
  "private": true,
  "type": "module"
}
JSON

  cat > "${smoke_file}" <<'TS'
export function qwenLocalSmoke(): string {
    return "before";
}
TS
}

verify_scratch_code_change() {
  if grep -q 'return "after";' "${smoke_file}"; then
    echo "Verified scratch code edit: ${smoke_file}"
    return 0
  fi

  echo "Scratch code edit was not applied. Current file:" >&2
  sed -n '1,80p' "${smoke_file}" >&2
  return 1
}

wait_for_ollama_native_api() {
  for attempt in {1..60}; do
    if curl_ollama http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
      return 0
    fi

    if [ "${attempt}" -eq 60 ]; then
      echo "Ollama did not start in time." >&2
      [ -f "${ollama_log}" ] && sed -n '1,160p' "${ollama_log}" >&2
      return 1
    fi

    sleep 1
  done
}

wait_for_ollama_openai_api() {
  for attempt in {1..30}; do
    if curl_ollama "${openai_base_url}/models" >/dev/null 2>&1; then
      return 0
    fi

    if [ "${attempt}" -eq 30 ]; then
      echo "Ollama native API is up, but ${openai_base_url}/models is unavailable." >&2
      [ -f "${ollama_log}" ] && sed -n '1,160p' "${ollama_log}" >&2
      return 1
    fi

    sleep 2
  done
}

verify_ollama_model_is_available() {
  if curl_ollama http://127.0.0.1:11434/api/tags \
    | jq -e --arg model "${model}" 'any(.models[]?; .name == $model)' >/dev/null; then
    return 0
  fi

  echo "Ollama did not report the pulled model '${model}' in /api/tags." >&2
  return 1
}

warm_ollama_openai_chat() {
  local request_body
  request_body="$(
    jq -n --arg model "${model}" '{
      model: $model,
      messages: [{role: "user", content: "Reply with ok."}],
      max_tokens: 8,
      stream: false
    }'
  )"

  if curl_ollama --max-time 300 -X POST "${openai_base_url}/chat/completions" \
    -H "Authorization: Bearer ${openai_api_key}" \
    -H "Content-Type: application/json" \
    -d "${request_body}" >/dev/null; then
    return 0
  fi

  echo "Ollama OpenAI-compatible chat completion failed for '${model}'." >&2
  [ -f "${ollama_log}" ] && sed -n '1,160p' "${ollama_log}" >&2
  return 1
}

verify_qwen_exposes_required_tools() {
  local log_dir
  local missing_tools

  log_dir="${smoke_workspace}/openai-tool-registry"
  rm -rf "${log_dir}"
  mkdir -p "${log_dir}"

  (
    cd "${repo_root}"
    printf 'Reply with ok only.\n' | qwen \
      --yolo \
      --channel CI \
      --max-session-turns 1 \
      --output-format text \
      --openai-logging \
      --openai-logging-dir "${log_dir}" \
      --auth-type openai \
      --openai-api-key "${openai_api_key}" \
      --openai-base-url="${openai_base_url}" \
      --model="${model}" >/dev/null
  )

  if ! compgen -G "${log_dir}/openai-*.json" >/dev/null; then
    echo "Qwen Code did not write OpenAI request logs for the tool registry probe." >&2
    return 1
  fi

  missing_tools="$(
    jq -r -s '
      [.[].request.tools[]?.function.name] | unique as $available
      | ["read_file", "write_file", "edit", "run_shell_command"] as $required
      | ($required - $available)[]
    ' "${log_dir}"/openai-*.json
  )"

  if [ -n "${missing_tools}" ]; then
    echo "Qwen Code did not expose required native tools to the model:" >&2
    printf '%s\n' "${missing_tools}" >&2
    return 1
  fi

  echo "Verified Qwen Code exposes required native tools: read_file, write_file, edit, run_shell_command"
}

start_ollama_if_needed() {
  if curl_ollama http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    return 0
  fi

  ollama serve > "${ollama_log}" 2>&1 &
  started_ollama_pid="$!"
}

run_mock_agent() {
  cat > "${smoke_file}" <<'TS'
export function qwenLocalSmoke(): string {
    return "after";
}
TS
}

verify_qwen_tool_calls() {
  local system_prompt
  local smoke_prompt

  rm -f "${tool_smoke_file}"

  system_prompt="$(cat <<'PROMPT'
You are running in GitHub Actions as an autonomous coding agent.
Use real Qwen Code tool calls for shell commands and file edits.
Do not print JSON objects that describe intended tool calls.
Do not respond with a plan-only answer, standalone JSON, or instructions for another process.
The token startNewTask is not a tool.
Keep using tools until the task is complete or a real blocker prevents progress.
Leave any code changes in the worktree; the workflow will commit and push them.
PROMPT
)"

  smoke_prompt="$(printf 'Use the run_shell_command tool to run this exact shell command: printf qwen-local-tool-smoke > %q\nDo not answer in text. Do not print JSON. Call the tool.\n' "${tool_smoke_file}")"

  (
    cd "${repo_root}"
    printf '%s\n' "${smoke_prompt}" | qwen \
      --yolo \
      --channel CI \
      --max-session-turns "${tool_smoke_turns}" \
      --append-system-prompt "${system_prompt}" \
      --auth-type openai \
      --openai-api-key "${openai_api_key}" \
      --openai-base-url="${openai_base_url}" \
      --model="${model}"
  )

  if [ "$(cat "${tool_smoke_file}" 2>/dev/null || true)" = "qwen-local-tool-smoke" ]; then
    rm -f "${tool_smoke_file}"
    return 0
  fi

  echo "Qwen Code completed without proving it can call shell tools through '${model}'." >&2
  return 1
}

run_qwen_agent() {
  local system_prompt
  local task_prompt

  system_prompt="$(cat <<'PROMPT'
You are running as an autonomous coding agent in a local smoke test.
Use real Qwen Code shell and file-edit tools.
For shell commands, call the native run_shell_command tool by name.
For file changes, call the native edit or write_file tools by name.
Do not print JSON objects that describe intended tool calls.
Do not respond with a plan-only answer.
Keep using tools until the requested scratch file edit is complete.
PROMPT
)"

  task_prompt="$(cat <<PROMPT
Call the write_file tool exactly once with these arguments:
file_path: ${smoke_file}
content: export function qwenLocalSmoke(): string {\\n    return "after";\\n}\\n

Do not call open_file.
Do not answer in text.
Do not print JSON.
Call write_file.
PROMPT
)"

  (
    cd "${repo_root}"
    printf '%s\n' "${task_prompt}" | qwen \
      --yolo \
      --channel CI \
      --max-session-turns "${max_session_turns}" \
      --append-system-prompt "${system_prompt}" \
      --auth-type openai \
      --openai-api-key "${openai_api_key}" \
      --openai-base-url="${openai_base_url}" \
      --model="${model}"
  )
}

main() {
  if [ "${mode}" = "real" ]; then
    require_command curl
    require_command jq
    install_qwen_if_missing
    install_ollama_if_missing
    require_command ollama
    require_command qwen
  fi

  prepare_smoke_workspace

  if [ "${mode}" = "mock" ]; then
    run_mock_agent
    verify_scratch_code_change
    echo "Mock qwen-local smoke passed."
    exit 0
  fi

  start_ollama_if_needed
  wait_for_ollama_native_api
  ollama pull "${model}"
  verify_ollama_model_is_available
  wait_for_ollama_openai_api
  warm_ollama_openai_chat
  verify_qwen_exposes_required_tools
  verify_qwen_tool_calls
  run_qwen_agent
  verify_scratch_code_change
  echo "Real qwen-local smoke passed."
}

main
