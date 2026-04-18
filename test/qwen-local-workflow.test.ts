import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function readWorkflowSource(fileName: string): Promise<string> {
    return readFile(path.resolve(process.cwd(), ".github/workflows", fileName), "utf8");
}

async function readQwenSettingsSource(): Promise<string> {
    return readFile(path.resolve(process.cwd(), ".qwen/settings.json"), "utf8");
}

async function readAllWorkflowSources(): Promise<string> {
    const workflowDirectory = path.resolve(process.cwd(), ".github/workflows");
    const directoryEntries = await readdir(workflowDirectory);
    const workflowFileNames = directoryEntries.filter(
        (fileName) => fileName.endsWith(".yml") || fileName.endsWith(".yaml")
    );
    const workflowSources = await Promise.all(
        workflowFileNames.map(async (fileName) => {
            const source = await readFile(path.join(workflowDirectory, fileName), "utf8");

            return `# ${fileName}\n${source}`;
        })
    );

    return workflowSources.join("\n");
}

function assertQwenRunsWithCiAgentLoop(source: string): void {
    assert.match(source, /export QWEN_MAX_SESSION_TURNS="\$\{\{ vars\.QWEN_MAX_SESSION_TURNS \|\| '40' \}\}"/u);
    assert.match(source, /QWEN_CI_SYSTEM_PROMPT="\$\(cat <<'PROMPT'/u);
    assert.match(source, /autonomous coding agent/u);
    assert.match(source, /Do not respond with a plan-only answer, standalone JSON/u);
    assert.match(source, /Keep using tools until the task is complete/u);
    assert.ok(
        source.includes("printf '%s\\n' \"${ADDITIONAL_CONTEXT}\" | qwen \\"),
        "Qwen should receive the PR prompt through stdin for non-interactive CI execution."
    );
    assert.match(source, /--yolo/u);
    assert.match(source, /--channel CI/u);
    assert.match(source, /--max-session-turns "\$\{QWEN_MAX_SESSION_TURNS\}"/u);
    assert.match(source, /--append-system-prompt "\$\{QWEN_CI_SYSTEM_PROMPT\}"/u);
    assert.doesNotMatch(source, /--prompt-interactive/u);
}

function assertQwenLocalUsesExplicitLintPrompt(source: string): void {
    assert.match(source, /QWEN_LOCAL_TASK_PROMPT="\$\(cat <<'PROMPT'/u);
    assert.match(source, /Find and fix exactly one ESLint warning/u);
    assert.match(source, /First, make a shell tool call to run `pnpm run lint`/u);
    assert.match(source, /Do not output a JSON plan, a fake function call, or `startNewTask`/u);
    assert.match(source, /The token startNewTask is not a tool/u);
    assert.ok(
        source.includes("# printf '%s\\n' \"${ADDITIONAL_CONTEXT}\" | qwen \\"),
        "Qwen local prompt inheritance should remain commented out while local tool-calling is stabilized."
    );
    assert.ok(
        source.includes("printf '%s\\n' \"${QWEN_LOCAL_TASK_PROMPT}\" | qwen \\"),
        "Qwen local should receive the focused lint prompt through stdin for non-interactive CI execution."
    );
    assert.doesNotMatch(
        source,
        /^\s*printf '%s\\n' "\$\{ADDITIONAL_CONTEXT\}" \| qwen \\$/mu,
        "Qwen local should not execute the inherited comment prompt."
    );
    assert.match(source, /--yolo/u);
    assert.match(source, /--channel CI/u);
    assert.match(source, /--max-session-turns "\$\{QWEN_MAX_SESSION_TURNS\}"/u);
    assert.match(source, /--append-system-prompt "\$\{QWEN_CI_SYSTEM_PROMPT\}"/u);
    assert.doesNotMatch(source, /--prompt-interactive/u);
}

void test("qwen local workflow routes only @qwen-local comments through the reusable agent runner", async () => {
    const localSource = await readWorkflowSource("qwen-local-code-tasks.yml");
    const remoteSource = await readWorkflowSource("qwen-invoke.yml");

    assert.match(localSource, /startsWith\(github\.event\.comment\.body \|\| '', '@qwen-local'\)/u);
    assert.match(localSource, /uses: \.\/\.github\/workflows\/agent-invoke\.yml/u);
    assert.match(localSource, /agent: qwen-local/u);
    assert.match(localSource, /agent_cli: qwen/u);
    assert.match(localSource, /agent_package: '@qwen-code\/qwen-code@latest'/u);
    assert.match(remoteSource, /!startsWith\(github\.event\.comment\.body \|\| '', '@qwen-local'\)/u);
});

void test("qwen local workflow uses a small tool-capable Ollama model by default", async () => {
    const source = await readWorkflowSource("qwen-local-code-tasks.yml");

    assert.match(source, /export QWEN_LOCAL_MODEL="\$\{\{ vars\.QWEN_LOCAL_MODEL \|\| 'qwen2\.5-coder:1\.5b' \}\}"/u);
    assert.match(source, /ollama pull "\$\{QWEN_LOCAL_MODEL\}"/u);
    assert.match(source, /curl -fsS "\$\{OPENAI_BASE_URL\}\/models"/u);
    assert.match(source, /--model="\$\{QWEN_LOCAL_MODEL\}"/u);
    assert.doesNotMatch(source, /qwen2\.5-coder:0\.5b/u);
});

void test("qwen settings are tuned for CPU-only local Ollama runs", async () => {
    const workflowSource = await readWorkflowSource("qwen-local-code-tasks.yml");
    const settingsSource = await readQwenSettingsSource();

    assert.doesNotMatch(workflowSource, /QWEN_CODE_MAX_OUTPUT_TOKENS/u);
    assert.doesNotMatch(workflowSource, /> "\$\{HOME\}\/\.qwen\/settings\.json"/u);
    assert.match(settingsSource, /"skipStartupContext": true/u);
    assert.match(settingsSource, /"maxSessionTurns": 40/u);
    assert.match(settingsSource, /"generationConfig": \{/u);
    assert.match(settingsSource, /"timeout": 1200000/u);
    assert.match(settingsSource, /"maxRetries": 0/u);
    assert.match(settingsSource, /"samplingParams": \{/u);
    assert.match(settingsSource, /"max_tokens": 4096/u);
    assert.ok(
        settingsSource.indexOf('"generationConfig": {') < settingsSource.indexOf('"chatCompression": {'),
        "Qwen generation settings should live under the checked-in model settings."
    );
});

void test("qwen local workflow only starts Ollama when the API is unavailable", async () => {
    const source = await readWorkflowSource("qwen-local-code-tasks.yml");

    assert.match(source, /if ! curl -fsS http:\/\/127\.0\.0\.1:11434\/api\/version >\/dev\/null 2>&1; then/u);
    assert.match(source, /ollama serve > ollama\.log 2>&1 &/u);
    assert.match(source, /for attempt in \{1\.\.30\}; do/u);
    assert.ok(
        source.indexOf("ollama serve > ollama.log 2>&1 &") < source.indexOf("for attempt in {1..30}; do"),
        "workflow should start the fallback server before waiting for the API."
    );
});

void test("qwen local workflow selects OpenAI-compatible auth for Ollama", async () => {
    const source = await readWorkflowSource("qwen-local-code-tasks.yml");
    const authTypeIndex = source.indexOf("--auth-type openai");
    const apiKeyIndex = source.indexOf('--openai-api-key "${OPENAI_API_KEY}"');
    const baseUrlIndex = source.indexOf('--openai-base-url="${OPENAI_BASE_URL}"');

    assert.match(source, /export OPENAI_API_KEY="ollama"/u);
    assert.match(source, /export OPENAI_BASE_URL="http:\/\/127\.0\.0\.1:11434\/v1"/u);
    assert.notEqual(authTypeIndex, -1, "Qwen should use OpenAI-compatible auth against Ollama.");
    assert.ok(authTypeIndex < apiKeyIndex, "Qwen auth type should be selected before OpenAI credentials.");
    assert.ok(apiKeyIndex < baseUrlIndex, "OpenAI-compatible credentials should be paired with the Ollama endpoint.");
});

void test("qwen remote invocation is configured to keep using tools in CI", async () => {
    const remoteSource = await readWorkflowSource("qwen-invoke.yml");

    assertQwenRunsWithCiAgentLoop(remoteSource);
});

void test("qwen local invocation uses a focused lint prompt instead of inherited task text", async () => {
    const localSource = await readWorkflowSource("qwen-local-code-tasks.yml");

    assertQwenLocalUsesExplicitLintPrompt(localSource);
});

void test("reusable agent workflow reads Node and pnpm versions from repository sources", async () => {
    const source = await readWorkflowSource("agent-invoke.yml");

    assert.match(source, /Read Node version from \.nvmrc/u);
    assert.match(source, /echo "version=\$\(cat \.nvmrc\)" >> "\$GITHUB_OUTPUT"/u);
    assert.match(source, /Read pnpm version from package\.json/u);
    assert.match(source, /packageManager\.split\('@'\)\[1\]/u);
    assert.match(source, /version: \$\{\{ steps\.read-pnpm-version\.outputs\.version \}\}/u);
    assert.match(source, /uses: actions\/setup-node@v6/u);
    assert.match(source, /node-version: \$\{\{ steps\.read-node-version\.outputs\.version \}\}/u);
    assert.doesNotMatch(source, /version: 10\.32\.1/u);
    assert.doesNotMatch(source, /node-version: "22"/u);
});

void test("GitHub workflows do not hardcode repository Node or pnpm versions", async () => {
    const source = await readAllWorkflowSources();

    assert.doesNotMatch(source, /^\s*version:\s*10\.32\.1\s*$/mu);
    assert.doesNotMatch(source, /^\s*node-version:\s*["']?22["']?\s*$/mu);
    assert.doesNotMatch(source, /pnpm@10\.32\.1/u);
});
