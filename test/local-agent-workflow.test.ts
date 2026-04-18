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

async function readAiderConfigSource(): Promise<string> {
    return readFile(path.resolve(process.cwd(), ".aider.conf.yml"), "utf8");
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

function assertQwenUsesLocalAgentLoop(source: string): void {
    assert.match(source, /github\.event\.comment\.body == '@qwen'/u);
    assert.match(source, /startsWith\(github\.event\.comment\.body \|\| '', '@qwen '\)/u);
    assert.match(source, /uses: \.\/\.github\/workflows\/agent-invoke\.yml/u);
    assert.match(source, /agent: qwen/u);
    assert.doesNotMatch(source, /agent_cli:/u);
    assert.match(source, /QWEN_TASK_PROMPT="\$\(cat <<'PROMPT'/u);
    assert.match(source, /Use Qwen Code tools for every repository inspection and edit/u);
    assert.match(source, /Start by calling run_shell_command for the first validation or inspection command requested by the user/u);
    assert.match(source, /Do not output a JSON plan, a fake function call, or `startNewTask`/u);
    assert.match(source, /The token startNewTask is not a tool/u);
    assert.match(source, /QWEN_AGENT_PROMPT="\$\(printf '%s\\n\\nUser task from PR comment:\\n%s\\n'/u);
    assert.match(source, /printf '%s\\n' "\$\{QWEN_AGENT_PROMPT\}" \| stdbuf -oL -eL qwen \\/u);
    assert.match(source, /pull_qwen_configured_model\(\)/u);
    assert.match(source, /\.qwen\/settings\.json/u);
    assert.match(source, /ollama pull "\$\{configured_model\}"/u);
    assert.match(source, /verify_qwen_tool_calls\(\)/u);
    assert.match(source, /qwen-tool-smoke/u);
    assert.match(source, /Qwen Code completed without proving it can call shell tools/u);
    assert.match(source, /--yolo/u);
    assert.match(source, /--channel CI/u);
    assert.match(source, /--append-system-prompt "\$\{QWEN_CI_SYSTEM_PROMPT\}"/u);
    assert.doesNotMatch(source, /--prompt-interactive/u);
}

void test("qwen invoke is the single local-only Qwen workflow", async () => {
    const source = await readWorkflowSource("qwen-invoke.yml");
    const workflowFileNames = await readdir(path.resolve(process.cwd(), ".github/workflows"));

    assertQwenUsesLocalAgentLoop(source);
    assert.ok(
        source.lastIndexOf("pull_qwen_configured_model") < source.lastIndexOf("verify_qwen_exposes_required_tools"),
        "Qwen must pull the configured local model before probing model-backed tool calls."
    );
    assert.match(source, /agent_package: \$\{\{ vars\.QWEN_CODE_PACKAGE \|\| '@qwen-code\/qwen-code@0\.14\.5' \}\}/u);
    assert.doesNotMatch(source, /OPENROUTER_API_KEY/u);
    assert.doesNotMatch(source, /QWEN_OPENAI_MODEL/u);
    assert.doesNotMatch(source, /@qwen-local/u);
    assert.ok(!workflowFileNames.includes("qwen-local-code-tasks.yml"));
});

void test("qwen invoke uses checked-in settings for local model selection", async () => {
    const workflowSource = await readWorkflowSource("qwen-invoke.yml");
    const settingsSource = await readQwenSettingsSource();

    assert.doesNotMatch(workflowSource, /local_ollama_model:/u);
    assert.doesNotMatch(workflowSource, /--model=/u);
    assert.doesNotMatch(workflowSource, /QWEN_CODE_MAX_OUTPUT_TOKENS/u);
    assert.doesNotMatch(workflowSource, /> "\$\{HOME\}\/\.qwen\/settings\.json"/u);
    assert.match(settingsSource, /"name": "qwen3:1\.7b"/u);
    assert.match(settingsSource, /"skipStartupContext": true/u);
    assert.match(settingsSource, /"generationConfig": \{/u);
    assert.match(settingsSource, /"timeout": 900000/u);
    assert.match(settingsSource, /"maxRetries": 0/u);
    assert.match(settingsSource, /"samplingParams": \{/u);
    assert.match(settingsSource, /"max_tokens": 1536/u);
    assert.match(settingsSource, /"maxSessionTurns": 12/u);
    assert.ok(
        settingsSource.indexOf('"generationConfig": {') < settingsSource.indexOf('"chatCompression": {'),
        "Qwen generation settings should live under the checked-in model settings."
    );
});

void test("aider invoke is the single local-only Aider workflow", async () => {
    const source = await readWorkflowSource("aider-invoke.yml");
    const workflowFileNames = await readdir(path.resolve(process.cwd(), ".github/workflows"));

    assert.match(source, /name: '▶️ Aider Invoke'/u);
    assert.match(source, /github\.event\.comment\.body == '@aider'/u);
    assert.match(source, /startsWith\(github\.event\.comment\.body \|\| '', '@aider '\)/u);
    assert.match(source, /uses: \.\/\.github\/workflows\/agent-invoke\.yml/u);
    assert.match(source, /agent: aider/u);
    assert.doesNotMatch(source, /agent_cli:/u);
    assert.match(source, /pull_aider_configured_model\(\)/u);
    assert.match(source, /\.aider\.conf\.yml/u);
    assert.match(source, /ollama_model="\$\{configured_model#openai\/\}"/u);
    assert.match(source, /ollama pull "\$\{ollama_model\}"/u);
    assert.ok(
        source.lastIndexOf("pull_aider_configured_model") < source.indexOf("AIDER_TASK_MESSAGE_FILE"),
        "Aider must pull the configured local model before invoking the CLI."
    );
    assert.match(source, /aider[\s\S]*--yes-always[\s\S]*--no-browser[\s\S]*--subtree-only[\s\S]*--message-file/u);
    assert.doesNotMatch(source, /OPENAI_API_TYPE/u);
    assert.doesNotMatch(source, /@aider-local/u);
    assert.doesNotMatch(source, /--model/u);
    assert.ok(!workflowFileNames.includes("aider-local-code-tasks.yml"));
});

void test("aider invoke uses a repo-local .aider.conf.yml for local Ollama settings", async () => {
    const source = await readAiderConfigSource();

    assert.doesNotMatch(source, /provider:/u);
    assert.doesNotMatch(source, /openai-api-type:/u);
    assert.match(source, /model: openai\/qwen3:1\.7b/u);
    assert.match(source, /openai-api-key: ollama/u);
    assert.match(source, /openai-api-base: http:\/\/127\.0\.0\.1:11434\/v1/u);
    assert.match(source, /dirty-commits: true/u);
});

void test("agent invoke validates local OpenAI-compatible endpoint without loading models", async () => {
    const source = await readWorkflowSource("agent-invoke.yml");

    assert.doesNotMatch(source, /^\s*model:\n\s*type: string\n\s*required: false/mu);
    assert.doesNotMatch(source, /inputs\.model/u);
    assert.doesNotMatch(source, /agent_cli:/u);
    assert.doesNotMatch(source, /inputs\.agent_cli/u);
    assert.doesNotMatch(source, /\.qwen\/settings\.json/u);
    assert.doesNotMatch(source, /\.aider\.conf\.yml/u);
    assert.doesNotMatch(source, /LOCAL_MODEL/u);
    assert.doesNotMatch(source, /ollama pull/u);
    assert.doesNotMatch(source, /chat\/completions/u);
    assert.match(source, /validate_local_endpoint:/u);
    assert.match(source, /OLLAMA_NATIVE_URL='http:\/\/127\.0\.0\.1:11434'/u);
    assert.match(source, /\$\{OLLAMA_NATIVE_URL\}\/api\/version/u);
    assert.match(source, /\$\{OPENAI_BASE_URL%\/\}\/models/u);
    assert.match(source, /jq -e 'type == "object"'/u);
    assert.doesNotMatch(source, /\.data \| type == "array"/u);
    assert.ok(source.includes('echo "OPENAI_BASE_URL=${OPENAI_BASE_URL}" >> "$GITHUB_ENV"'));
    assert.ok(source.includes('echo "OPENAI_API_KEY=${OPENAI_API_KEY}" >> "$GITHUB_ENV"'));
});

void test("agent invoke exports OpenAI API type for every child agent", async () => {
    const parentSource = await readWorkflowSource("agent-invoke.yml");
    const aiderSource = await readWorkflowSource("aider-invoke.yml");

    assert.match(parentSource, /env:\n\s+OPENAI_API_TYPE: openai/u);
    assert.doesNotMatch(aiderSource, /export OPENAI_API_TYPE=/u);
    assert.doesNotMatch(aiderSource, /--set-env OPENAI_API_TYPE=openai/u);
});

void test("agent invoke streams custom command output while preserving exit status", async () => {
    const source = await readWorkflowSource("agent-invoke.yml");

    assert.match(source, /stdbuf -oL -eL bash "\$script" 2>&1 \| tee "\$RUNNER_TEMP\/agent-live\.log"/u);
    assert.match(source, /agent_status="\$\{PIPESTATUS\[0\]\}"/u);
    assert.match(source, /exit "\$\{agent_status\}"/u);
});

void test("agent invoke workflow fails when a successful agent run produces no push", async () => {
    const source = await readWorkflowSource("agent-invoke.yml");

    assert.match(source, /if \[ "\$\{\{ steps\.run_agent\.outcome \}\}" = "failure" \] \|\| \[ "\$\{\{ steps\.run_agent\.conclusion \}\}" = "failure" \]; then/u);
    assert.match(source, /if \[ -f "\$SENTINEL" \]; then/u);
    assert.match(source, /echo "Agent command succeeded with no branch push → FAIL\."/u);
});

void test("agent invoke workflow always attempts auto-commit and push after the agent command", async () => {
    const source = await readWorkflowSource("agent-invoke.yml");

    assert.match(source, /- name: Auto-commit and push agent changes if needed/u);
    assert.match(source, /if: always\(\)/u);
    assert.match(source, /if ! git diff --quiet \|\| ! git diff --cached --quiet; then/u);
    assert.match(source, /git add -A/u);
    assert.match(source, /git commit -m "\$commit_message"/u);
    assert.match(source, /elif \[ "\$\{has_worktree_changes\}" = true \]; then/u);
    assert.match(source, /echo "\[agent\] New commit created; will push\."/u);
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
