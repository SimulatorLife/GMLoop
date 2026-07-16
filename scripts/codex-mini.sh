#!/usr/bin/env bash
# Run Codex with MiniMax-M3 through the persistent Responses compatibility
# proxy. The proxy is intentionally separate from Codex's process lifetime so
# child agents can continue using it after the parent turn creates them.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"

proxy_host="${CODEX_MINIMAX_PROXY_HOST:-127.0.0.1}"
proxy_port="${CODEX_MINIMAX_PROXY_PORT:-18765}"
proxy_url="http://${proxy_host}:${proxy_port}"
proxy_log="${CODEX_MINIMAX_PROXY_LOG:-${TMPDIR:-/tmp}/codex-minimax-proxy-${proxy_port}.log}"
proxy_pid_file="${CODEX_MINIMAX_PROXY_PID_FILE:-${TMPDIR:-/tmp}/codex-minimax-proxy-${proxy_port}.pid}"

proxy_is_ready() {
  curl --silent --fail --max-time 1 "${proxy_url}/health" >/dev/null 2>&1
}

start_proxy() {
  mkdir -p "$(dirname -- "$proxy_log")" "$(dirname -- "$proxy_pid_file")"

  MINIMAX_PROXY_HOST="$proxy_host" \
  MINIMAX_PROXY_PORT="$proxy_port" \
  MINIMAX_PROXY_UPSTREAM_BASE_URL="${CODEX_MINIMAX_UPSTREAM_URL:-https://api.minimax.io}" \
  nohup node --input-type=module \
    >"$proxy_log" 2>&1 \
    </dev/null <<'NODE' &
import { createServer } from "node:http";

const host = process.env.MINIMAX_PROXY_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.MINIMAX_PROXY_PORT ?? "18765", 10);
const upstreamBaseUrl = process.env.MINIMAX_PROXY_UPSTREAM_BASE_URL ?? "https://api.minimax.io";
const flattenedNamespaces = [
  ["multi_agent_v1", "multi_agent_v1__"],
  ["collaboration", "collaboration__"],
  ["agents", "agents__"]
];

function rewrite(value) {
  if (Array.isArray(value)) {
    return value.map(rewrite);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = rewrite(child);
  }

  if (typeof result.name === "string" && (result.namespace === undefined || result.namespace === null)) {
    const match = flattenedNamespaces.find(([, prefix]) => result.name.startsWith(prefix));
    if (match) {
      result.namespace = match[0];
      result.name = result.name.slice(match[1].length);
    }
  }
  return result;
}

function rewriteSseLine(line) {
  const lineEnding = line.endsWith("\r") ? "\r" : "";
  const content = lineEnding ? line.slice(0, -1) : line;
  if (!content.startsWith("data:")) {
    return line;
  }
  const data = content.slice(5).trimStart();
  if (!data || data === "[DONE]") {
    return line;
  }
  try {
    return `data: ${JSON.stringify(rewrite(JSON.parse(data)))}${lineEnding}`;
  } catch {
    return line;
  }
}

function requestHeaders(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (
      value === undefined ||
      ["connection", "content-length", "host", "transfer-encoding"].includes(name.toLowerCase())
    ) {
      continue;
    }
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length === 0 ? undefined : Buffer.concat(chunks).toString("utf8");
}

function upstreamHeaders(response, upstream) {
  for (const [name, value] of upstream.headers) {
    if (["connection", "content-encoding", "content-length", "transfer-encoding"].includes(name.toLowerCase())) {
      continue;
    }
    response.setHeader(name, value);
  }
}

async function streamSse(body, response) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bufferedLine = "";

  const readNextChunk = async () => {
    const result = await reader.read();
    if (result.done) {
      bufferedLine += decoder.decode();
      if (bufferedLine) {
        response.write(rewriteSseLine(bufferedLine));
      }
      response.end();
      return;
    }

    bufferedLine += decoder.decode(result.value, { stream: true });
    const lines = bufferedLine.split("\n");
    bufferedLine = lines.pop() ?? "";
    for (const line of lines) {
      response.write(`${rewriteSseLine(line)}\n`);
    }
    await readNextChunk();
  };

  await readNextChunk();
}

function proxyError(response, error) {
  if (response.headersSent || response.destroyed) {
    return;
  }
  response.writeHead(502, { "content-type": "application/json" });
  response.end(JSON.stringify({
    error: {
      message: error instanceof Error ? error.message : "Upstream request failed.",
      type: "minimax_responses_proxy_error"
    }
  }));
}

async function forward(request, response) {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok\n");
    return;
  }

  const abortController = new AbortController();
  const abortUpstream = () => abortController.abort();
  request.once("aborted", abortUpstream);
  response.once("close", () => {
    if (!response.writableFinished) {
      abortUpstream();
    }
  });

  try {
    const upstream = await fetch(new URL(request.url ?? "/", upstreamBaseUrl), {
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await requestBody(request),
      headers: requestHeaders(request),
      method: request.method,
      signal: abortController.signal
    });
    upstreamHeaders(response, upstream);
    response.writeHead(upstream.status);
    if (upstream.body === null) {
      response.end();
      return;
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().includes("text/event-stream")) {
      await streamSse(upstream.body, response);
      return;
    }

    const responseText = await upstream.text();
    if (contentType.toLowerCase().includes("application/json")) {
      try {
        response.end(JSON.stringify(rewrite(JSON.parse(responseText))));
        return;
      } catch {
        // Preserve malformed/non-JSON upstream responses unchanged.
      }
    }
    response.end(responseText);
  } catch (error) {
    proxyError(response, error);
  } finally {
    request.removeListener("aborted", abortUpstream);
  }
}

createServer((request, response) => {
  void forward(request, response);
}).listen(port, host, () => {
  process.stderr.write(`MiniMax Responses proxy listening at http://${host}:${port}.\n`);
});
NODE
  printf '%s\n' "$!" >"$proxy_pid_file"

  for _ in {1..50}; do
    if proxy_is_ready; then
      return 0
    fi
    sleep 0.1
  done

  echo "Timed out starting the MiniMax Responses proxy at ${proxy_url}." >&2
  echo "Proxy log: $proxy_log" >&2
  cat "$proxy_log" >&2 2>/dev/null || true
  exit 1
}

if ! proxy_is_ready; then
  start_proxy
fi

exec codex \
  --disable memories \
  --disable multi_agent_v2 \
  --enable multi_agent \
  -c 'model="MiniMax-M3"' \
  -c 'model_provider="minimax"' \
  -c 'model_providers.minimax.name="MiniMax"' \
  -c "model_providers.minimax.base_url=\"${proxy_url}/v1\"" \
  -c 'model_providers.minimax.env_key="MINIMAX_API_KEY"' \
  -c 'model_providers.minimax.wire_api="responses"' \
  -c "model_catalog_json=\"$repo_root/.codex/minimax-model-catalog.json\"" \
  -c 'model_reasoning_effort="high"' \
  -c 'model_reasoning_summary="none"' \
  "$@"
