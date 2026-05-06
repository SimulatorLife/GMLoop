import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function readWorkflowSource(fileName: string): Promise<string> {
    return readFile(path.resolve(process.cwd(), ".github/workflows", fileName), "utf8");
}

interface QwenSettings {
    model: {
        name: string;
    };
    permissions: {
        allow: string[];
        deny: string[];
    };
}

async function readQwenSettings(): Promise<QwenSettings> {
    const source = await readFile(path.resolve(process.cwd(), ".qwen/settings.json"), "utf8");

    return JSON.parse(source) as QwenSettings;
}

interface GeminiSettings {
    model: {
        maxSessionTurns: number;
    };
    general: {
        sessionRetention: {
            enabled: boolean;
        };
    };
    tools: {
        core?: string[];
        useRipgrep: boolean;
        truncateToolOutputThreshold: number;
        autoAccept?: boolean;
        disableLLMCorrection?: boolean;
    };
}

async function readGeminiSettings(): Promise<GeminiSettings> {
    const source = await readFile(path.resolve(process.cwd(), ".gemini/settings.json"), "utf8");

    return JSON.parse(source) as GeminiSettings;
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

function getRequiredSharedAgentPrompt(source: string): string {
    const heredocMatch =
        /cat > "\$\{AGENT_PROMPT_FILE\}" <<PROMPT\n(?<prompt>[\s\S]*?)\n\s*PROMPT\n\s*export AGENT_PROMPT_FILE/u.exec(
            source
        );
    if (heredocMatch?.groups?.prompt) {
        return heredocMatch.groups.prompt;
    }

    const writerMatch =
        /write_agent_prompt_file\(\) \{\n(?<promptWriter>[\s\S]*?)\n\s*export AGENT_PROMPT_FILE\n\s*\}/u.exec(source);

    assert.ok(
        writerMatch?.groups?.promptWriter,
        "Parent workflow must materialize a shared AGENT_PROMPT_FILE for child agents."
    );

    return writerMatch.groups.promptWriter;
}

function getRequiredWorkflowInputBlock(source: string, inputName: string): string {
    const match = new RegExp(String.raw`\n {6}${inputName}:\n(?<block>(?: {8}.+\n)+)`, "u").exec(source);

    assert.ok(match?.groups?.block, `Workflow must define ${inputName}.`);

    return match.groups.block;
}

function getRequiredChildWorkflowCommand(source: string, inputName: string): string {
    const start = source.indexOf(`      ${inputName}: |`);

    assert.notEqual(start, -1, `Child workflow must define ${inputName}.`);

    const nextInput = /\n {6}[a-z_]+: /gu;
    nextInput.lastIndex = start + 1;
    const nextMatch = nextInput.exec(source);
    const end = nextMatch?.index ?? source.length;

    return source.slice(start, end);
}

function getRequiredAiderCommand(source: string): string {
    const commandStartIndex = source.indexOf("stdbuf -oL -eL aider \\");
    assert.notEqual(commandStartIndex, -1, "Aider workflow must invoke aider with explicit CLI flags.");

    const commandTail = source.slice(commandStartIndex);
    const commandLines = commandTail.split("\n");
    const capturedCommandLines: string[] = [];

    for (const line of commandLines) {
        if (capturedCommandLines.length > 0 && line.includes("| tee ")) {
            capturedCommandLines.push(line);
            break;
        }
        if (capturedCommandLines.length > 0 || line.includes("stdbuf -oL -eL aider")) {
            capturedCommandLines.push(line);
        }
    }

    assert.ok(capturedCommandLines.length > 0, "Aider workflow command block must not be empty.");

    return capturedCommandLines.join("\n");
}

function getRequiredGeminiCommand(source: string): string {
    const directCommandStartIndex = source.indexOf("stdbuf -oL -eL gemini \\");
    const nodeCommandStartIndex = source.indexOf('stdbuf -oL -eL node --max-old-space-size=');
    const commandStartIndex =
        directCommandStartIndex === -1
            ? nodeCommandStartIndex
            : nodeCommandStartIndex === -1
              ? directCommandStartIndex
              : Math.min(directCommandStartIndex, nodeCommandStartIndex);

    assert.notEqual(commandStartIndex, -1, "Gemini workflow must invoke the Gemini CLI with streamed output.");

    const commandTail = source.slice(commandStartIndex);
    const commandLines = commandTail.split("\n");
    const capturedCommandLines: string[] = [];

    for (const line of commandLines) {
        if (capturedCommandLines.length > 0 && line.includes("| tee ")) {
            capturedCommandLines.push(line);
            break;
        }
        if (
            capturedCommandLines.length > 0 ||
            line.includes("stdbuf -oL -eL gemini") ||
            line.includes("stdbuf -oL -eL node --max-old-space-size=")
        ) {
            capturedCommandLines.push(line);
        }
    }

    assert.ok(capturedCommandLines.length > 0, "Gemini workflow command block must not be empty.");

    return capturedCommandLines.join("\n");
}

function assertAiderCommandIncludesRequiredFlags(commandSource: string): void {
    const commandLines = commandSource
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const requiredFlags = [
        "--yes-always",
        "--no-browser",
        "--subtree-only",
        "--no-auto-commits",
        "--no-dirty-commits",
        "--message"
    ];

    for (const requiredFlag of requiredFlags) {
        assert.ok(
            commandLines.some((line) => line.includes(requiredFlag)),
            `Aider command must include ${requiredFlag}.`
        );
    }
}

function assertWorkflowDispatchesToReusableAgent(source: string, agentName: string): void {
    assert.match(source, new RegExp(String.raw`contains\(github\.event\.comment\.body \|\| '', '@${agentName}'\)`, "u"));
    assert.match(source, /uses: \.\/\.github\/workflows\/agent-invoke\.yml/u);
    assert.match(source, new RegExp(String.raw`agent: ${agentName}`, "u"));
}

function assertWorkflowDeclaresAgentPackage(source: string, packageName: string): void {
    const escapedPackageName = packageName.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

    assert.match(source, new RegExp(String.raw`agent_package:\s*'?${escapedPackageName}(?:@[^'\s]+)?'?`, "u"));
}

function assertPromptEnforcesCommandGroundedEditLoop(prompt: string): void {
    assert.match(prompt, /Repository root:/u);
    assert.match(prompt, /User task from PR comment:/u);
    assert.match(prompt, /pnpm run lint/u);
    assert.match(prompt, /pnpm run build:ts/u);
    assert.match(prompt, /pnpm run lint:quiet/u);
    assert.match(prompt, /command output/u);
    assert.match(prompt, /diff|worktree/u);
    assert.match(prompt, /golden .*\.gml|\.gml fixtures/u);
    assert.match(prompt, /generated files/u);
    assert.match(prompt, /dist files/u);
}

function assertQwenUsesLocalAgentLoop(source: string, sharedPrompt: string): void {
    const setupCommand = getRequiredChildWorkflowCommand(source, "agent_setup_command");
    const agentCommand = getRequiredChildWorkflowCommand(source, "agent_command");

    assertWorkflowDispatchesToReusableAgent(source, "qwen");
    assert.doesNotMatch(source, /agent_cli:/u);
    assertPromptEnforcesCommandGroundedEditLoop(sharedPrompt);
    assert.doesNotMatch(source, /^\s*QWEN_CI_SYSTEM_PROMPT=/mu);
    assert.doesNotMatch(source, /^\s*QWEN_TASK_PROMPT=/mu);
    assert.doesNotMatch(source, /local-qwen-smoke/u);
    assert.match(source, /stdbuf -oL -eL qwen \\/u);
    assert.match(source, /--prompt ""/u);
    assert.match(source, /< "\$\{AGENT_PROMPT_FILE\}"/u);
    assert.doesNotMatch(source, /\$\(cat "\$\{AGENT_PROMPT_FILE\}"\)/u);
    assert.doesNotMatch(source, /QWEN_AGENT_PROMPT/u);
    assert.match(setupCommand, /pull_qwen_configured_model\(\)/u);
    assert.match(setupCommand, /\.qwen\/settings\.json/u);
    assert.match(setupCommand, /ollama pull "\$\{configured_model\}"/u);
    assert.doesNotMatch(agentCommand, /ollama pull/u);
    assert.match(agentCommand, /set \+e/u);
    assert.match(agentCommand, /agent_status="\$\{PIPESTATUS\[0\]\}"/u);
    assert.match(agentCommand, /set -e/u);
    assert.match(agentCommand, /if \[ "\$\{agent_status\}" -ne 0 \]; then/u);
    assert.match(agentCommand, /exit "\$\{agent_status\}"/u);
    assert.match(source, /(--approval-mode yolo|--yolo)/u);
    assert.doesNotMatch(source, /--append-system-prompt/u);
    assert.doesNotMatch(source, /--prompt-interactive/u);
    assert.doesNotMatch(source, /run_shell_command/u);
    assert.doesNotMatch(source, /edit or write_file tools/u);
}

void test("qwen invoke is the single local-only Qwen workflow", async () => {
    const source = await readWorkflowSource("qwen-invoke.yml");
    const parentSource = await readWorkflowSource("agent-invoke.yml");
    const workflowFileNames = await readdir(path.resolve(process.cwd(), ".github/workflows"));
    const sharedPrompt = getRequiredSharedAgentPrompt(parentSource);

    assertQwenUsesLocalAgentLoop(source, sharedPrompt);
    assert.ok(
        source.lastIndexOf("agent_setup_command") < source.lastIndexOf("agent_command"),
        "Qwen must pull the configured local model before invoking the real task."
    );
    assertWorkflowDeclaresAgentPackage(source, "@qwen-code/qwen-code");
    assert.doesNotMatch(source, /max_agent_retries:/u);
    assert.doesNotMatch(source, /verify_qwen_/u);
    assert.doesNotMatch(source, /openai-tool-registry/u);
    assert.doesNotMatch(source, /OPENROUTER_API_KEY/u);
    assert.doesNotMatch(source, /QWEN_OPENAI_MODEL/u);
    assert.doesNotMatch(source, /@qwen-local/u);
    assert.ok(!workflowFileNames.includes("qwen-local-code-tasks.yml"));
});

void test("qwen invoke uses checked-in settings for local model selection", async () => {
    const workflowSource = await readWorkflowSource("qwen-invoke.yml");
    const settings = await readQwenSettings();

    assert.doesNotMatch(workflowSource, /local_ollama_model:/u);
    assert.doesNotMatch(workflowSource, /--model=/u);
    assert.doesNotMatch(workflowSource, /QWEN_CODE_MAX_OUTPUT_TOKENS/u);
    assert.doesNotMatch(workflowSource, /> "\$\{HOME\}\/\.qwen\/settings\.json"/u);
    assert.equal(typeof settings.model.name, "string");
    assert.ok(settings.model.name.length > 0, "Qwen settings must declare a local model name.");
    assert.ok(settings.permissions.allow.includes("Read"));
    assert.ok(settings.permissions.allow.includes("Edit"));
    assert.ok(
        settings.permissions.allow.some((permission) => /^Bash\(pnpm\b/u.test(permission)),
        "Qwen settings must allow pnpm-backed repository validation commands."
    );
    assert.ok(
        settings.permissions.deny.some((permission) => permission.toLowerCase() === "websearch" || permission === "web_search"),
        "Qwen settings must deny web search tooling."
    );
    assert.ok(
        settings.permissions.deny.some((permission) => permission.toLowerCase() === "webfetch"),
        "Qwen settings must deny web fetch tooling."
    );
});

void test("aider invoke is the single local-only Aider workflow", async () => {
    const source = await readWorkflowSource("aider-invoke.yml");
    const parentSource = await readWorkflowSource("agent-invoke.yml");
    const workflowFileNames = await readdir(path.resolve(process.cwd(), ".github/workflows"));
    const sharedPrompt = getRequiredSharedAgentPrompt(parentSource);
    const setupCommand = getRequiredChildWorkflowCommand(source, "agent_setup_command");
    const agentCommand = getRequiredChildWorkflowCommand(source, "agent_command");
    const aiderCommand = getRequiredAiderCommand(source);

    assert.match(source, /name: '▶️ Aider Invoke'/u);
    assertWorkflowDispatchesToReusableAgent(source, "aider");
    assertWorkflowDeclaresAgentPackage(source, "aider-chat");
    assert.doesNotMatch(source, /max_agent_retries:/u);
    assert.doesNotMatch(source, /agent_cli:/u);
    assert.match(setupCommand, /pull_aider_configured_model\(\)/u);
    assert.match(setupCommand, /\.aider\.conf\.yml/u);
    assert.match(setupCommand, /ollama_model="\$\{configured_model#openai\/\}"/u);
    assert.match(setupCommand, /ollama pull "\$\{ollama_model\}"/u);
    assert.doesNotMatch(agentCommand, /ollama pull/u);
    assert.doesNotMatch(agentCommand, /command -v aider/u);
    assert.doesNotMatch(agentCommand, /pip install --user aider-chat/u);
    assert.doesNotMatch(agentCommand, /HOME\/\.local\/bin/u);
    assert.doesNotMatch(agentCommand, /Could not install Aider CLI/u);
    assertPromptEnforcesCommandGroundedEditLoop(sharedPrompt);
    assert.match(agentCommand, /--message-file "\$\{AGENT_PROMPT_FILE\}"/u);
    assert.doesNotMatch(source, /AIDER_TASK_MESSAGE_FILE/u);
    assert.doesNotMatch(source, /--message "\$\(cat/u);
    assert.ok(
        source.lastIndexOf("agent_setup_command") < source.indexOf("agent_command"),
        "Aider must pull the configured local model before invoking the CLI."
    );
    assertAiderCommandIncludesRequiredFlags(aiderCommand);
    assert.match(source, /aider_status="\$\{PIPESTATUS\[0\]\}"/u);
    assert.doesNotMatch(source, /Aider completed without producing local file changes/u);
    assert.doesNotMatch(source, /OPENAI_API_TYPE/u);
    assert.doesNotMatch(source, /@aider-local/u);
    assert.doesNotMatch(source, /--model/u);
    assert.ok(!workflowFileNames.includes("aider-local-code-tasks.yml"));
});

void test("gemini invoke is the maintained manual-only workflow for @gemini", async () => {
    const source = await readWorkflowSource("gemini-invoke.yml");
    const parentSource = await readWorkflowSource("agent-invoke.yml");
    const workflowFileNames = await readdir(path.resolve(process.cwd(), ".github/workflows"));
    const sharedPrompt = getRequiredSharedAgentPrompt(parentSource);
    const setupCommand = getRequiredChildWorkflowCommand(source, "agent_setup_command");
    const agentCommand = getRequiredChildWorkflowCommand(source, "agent_command");
    const geminiCommand = getRequiredGeminiCommand(source);

    assert.match(source, /name: '▶️ Gemini Invoke'/u);
    assertWorkflowDispatchesToReusableAgent(source, "gemini");
    assertWorkflowDeclaresAgentPackage(source, "@google/gemini-cli");
    assert.doesNotMatch(source, /max_agent_retries:/u);
    assert.doesNotMatch(source, /agent_cli:/u);
    assertPromptEnforcesCommandGroundedEditLoop(sharedPrompt);
    assert.match(sharedPrompt, /one focused, minimal code change set/u);
    assert.match(sharedPrompt, /Do not survey the entire repository exhaustively/u);
    assert.match(sharedPrompt, /targeted search/u);
    assert.match(sharedPrompt, /Keep command and tool output small/u);
    assert.match(sharedPrompt, /Do not finish with only analysis or a plan/u);
    assert.doesNotMatch(source, /^\s*GEMINI_TASK_PROMPT=/mu);
    assert.match(setupCommand, /\.gemini\/policies\/tools\.toml/u);
    assert.match(setupCommand, /cp ".gemini\/policies\/tools\.toml" "\$HOME\/.gemini\/policies\/tools\.toml"/u);
    assert.match(agentCommand, /export GEMINI_CLI_TRUST_WORKSPACE=true/u);
    assert.match(agentCommand, /export GEMINI_API_KEY="\$\{OPENAI_API_KEY\}"/u);
    assert.match(agentCommand, /export NODE_OPTIONS="--max-old-space-size=\d+"/u);
    assert.doesNotMatch(setupCommand, /bundle\/vendor\/ripgrep/u);
    assert.doesNotMatch(setupCommand, /ln -sf "\$\(command -v rg\)"/u);
    assert.match(geminiCommand, /--approval-mode(?:=| )yolo/u);
    assert.match(geminiCommand, /--skip-trust/u);
    assert.match(geminiCommand, /--output-format(?:=| )stream-json/u);
    assert.doesNotMatch(geminiCommand, /--model/u);
    assert.match(geminiCommand, /--prompt ""/u);
    assert.match(geminiCommand, /< "\$\{AGENT_PROMPT_FILE\}"/u);
    assert.match(source, /agent-stream\.jsonl/u);
    assert.doesNotMatch(geminiCommand, /\$\(cat "\$\{AGENT_PROMPT_FILE\}"\)/u);
    assert.doesNotMatch(agentCommand, /max_api_attempts="\$\{GEMINI_API_MAX_ATTEMPTS:-4\}"/u);
    assert.doesNotMatch(agentCommand, /RESOURCE_EXHAUSTED\|429\|quota exceeded\|rate\.\?limit/u);
    assert.doesNotMatch(agentCommand, /Please retry in/u);
    assert.doesNotMatch(agentCommand, /jitter_ms=\$\(\(RANDOM % 1000\)\)/u);
    assert.doesNotMatch(agentCommand, /sleep "\$\{sleep_seconds\}"/u);
    assert.doesNotMatch(source, /GEMINI_AGENT_PROMPT/u);
    assert.match(source, /agent_status="\$\{PIPESTATUS\[0\]\}"/u);
    assert.doesNotMatch(source, /ollama pull/u);
    assert.doesNotMatch(source, /_deprecated-gemini-invoke/u);
    assert.ok(!workflowFileNames.includes("_deprecated-gemini-invoke.yml"));
    assert.doesNotMatch(agentCommand, /ollama pull/u);
    assert.doesNotMatch(agentCommand, /GEMINI_MODEL/u);
});

void test("gemini settings allow the git commands required for merge-conflict resolution workflows", async () => {
    const settings = await readGeminiSettings();
    const allowedTools = settings.tools.core ?? [];

    assert.equal(settings.tools.useRipgrep, false);
    assert.ok(settings.model.maxSessionTurns > 0, "Gemini must allow at least one agent turn.");
    assert.ok(settings.tools.truncateToolOutputThreshold > 0, "Gemini must bound verbose tool output.");
    assert.ok(!allowedTools.includes("GrepTool"));
    assert.ok(!allowedTools.includes("RipGrepTool"));
    if (allowedTools.length > 0) {
        assert.ok(allowedTools.includes("LSTool"));
        assert.ok(allowedTools.includes("ReadFileTool"));
        assert.ok(allowedTools.includes("GlobTool"));
        assert.ok(allowedTools.includes("EditTool"));
        assert.ok(allowedTools.includes("WriteFileTool"));
        assert.ok(allowedTools.includes("ActivateSkillTool"));
        assert.ok(allowedTools.includes("run_shell_command"));
    } else {
        assert.equal(settings.tools.autoAccept, true);
        assert.equal(settings.tools.disableLLMCorrection, true);
    }
});

void test("aider invoke uses a repo-local .aider.conf.yml for local Ollama settings", async () => {
    const source = await readFile(path.resolve(process.cwd(), ".aider.conf.yml"), "utf8");

    assert.doesNotMatch(source, /provider:/u);
    assert.doesNotMatch(source, /openai-api-type:/u);
    assert.match(source, /^model:\s*\S+/mu);
    assert.match(source, /^openai-api-key:\s*\S+/mu);
    assert.match(source, /^openai-api-base:\s*http:\/\/(?:127\.0\.0\.1|localhost):\d+\/v1\s*$/mu);
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
    assert.match(source, /OLLAMA_NATIVE_URL="\$\{OPENAI_BASE_URL%\/\}"/u);
    assert.match(source, /OLLAMA_NATIVE_URL="\$\{OLLAMA_NATIVE_URL%\/v1\}"/u);
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

    assert.match(parentSource, /env:\n\s+OPENAI_API_TYPE: openai\n\s+OPENAI_BASE_URL: \$\{\{ inputs\.openai_base_url \}\}/u);
    assert.match(parentSource, /OPENAI_API_KEY: \$\{\{ secrets\.OPENAI_API_KEY \|\| 'ollama' \}\}/u);
    assert.doesNotMatch(parentSource, /NODE_OPTIONS: --max-old-space-size/u);
    assert.doesNotMatch(aiderSource, /export OPENAI_API_TYPE=/u);
    assert.doesNotMatch(aiderSource, /--set-env OPENAI_API_TYPE=openai/u);
});

void test("agent invoke streams custom command output while preserving exit status", async () => {
    const source = await readWorkflowSource("agent-invoke.yml");
    const setupInputBlock = getRequiredWorkflowInputBlock(source, "agent_setup_command");
    const setupFileInputBlock = getRequiredWorkflowInputBlock(source, "agent_setup_command_file");

    assert.match(setupInputBlock, /type: string/u);
    assert.match(setupInputBlock, /required: false/u);
    assert.match(setupFileInputBlock, /type: string/u);
    assert.match(setupFileInputBlock, /required: false/u);
    assert.match(source, /- name: Run agent setup command/u);
    assert.match(source, /if: \$\{\{ inputs\.agent_setup_command != '' \|\| inputs\.agent_setup_command_file != '' \}\}/u);
    assert.match(source, /AGENT_SETUP_COMMAND: \$\{\{ inputs\.agent_setup_command \}\}/u);
    assert.match(source, /AGENT_SETUP_COMMAND_FILE: \$\{\{ inputs\.agent_setup_command_file \}\}/u);
    assert.match(source, /if \[ -n "\$\{AGENT_SETUP_COMMAND_FILE:-\}" \]; then/u);
    assert.match(source, /\/\*\|\.\.\/\*\|\*\/\.\.\/\*\|\*\/\.\.\|\.\.\)/u);
    assert.match(source, /agent_setup_command_file must be a safe repository-relative path/u);
    assert.match(source, /source_setup_script="\$\{GITHUB_WORKSPACE\}\/\$\{AGENT_SETUP_COMMAND_FILE\}"/u);
    assert.match(source, /cp "\$\{source_setup_script\}" "\$setup_script"/u);
    assert.match(source, /printf '%s\\n' "\$\{AGENT_SETUP_COMMAND\}" > "\$setup_script"/u);
    assert.match(source, /sed -i 's\/\\r\$\/\/' "\$setup_script"/u);
    assert.match(source, /stdbuf -oL -eL bash "\$setup_script" 2>&1 \| tee "\$RUNNER_TEMP\/agent-setup\.log"/u);
    assert.match(source, /- name: Run agent custom command with retries/u);
    assert.match(source, /if: \$\{\{ inputs\.agent_command != '' \|\| inputs\.agent_command_file != '' \}\}/u);
    assert.match(source, /AGENT_COMMAND: \$\{\{ inputs\.agent_command \}\}/u);
    assert.match(source, /AGENT_COMMAND_FILE: \$\{\{ inputs\.agent_command_file \}\}/u);
    assert.match(source, /if \[ -n "\$\{AGENT_COMMAND_FILE:-\}" \]; then/u);
    assert.match(source, /agent_command_file must be a safe repository-relative path/u);
    assert.match(source, /stdbuf -oL -eL bash "\$script" 2>&1 \| tee "\$\{attempt_log\}"/u);
    assert.match(source, /agent_status="\$\{PIPESTATUS\[0\]\}"/u);
    assert.match(source, /return "\$\{agent_status\}"/u);
    assert.match(source, /cp "\$\{attempt_log\}" "\$RUNNER_TEMP\/agent-live\.log"/u);
});

void test("agent invoke accepts marker-prefixed agent comments but still requires the first meaningful line to target the agent", async () => {
    const source = await readWorkflowSource("agent-invoke.yml");

    assert.match(source, /BEGIN \{ skipping = 1 \}/u);
    assert.match(source, /if \(skipping && line ~ \/\^\[\[:space:\]\]\*\$\/\) next/u);
    assert.match(source, /line ~ \/\^\[\[:space:\]\]\*<!--\.\*-->\[\[:space:\]\]\*\$\/\) next/u);
    assert.match(source, /grep -qE "\^\$\{mention\}\(\[\[:space:\]\]\|\$\)"/u);
    assert.match(source, /Comment does not start with \$\{mention\} after optional marker lines; aborting\./u);
    assert.match(source, /sed -E "1s\/\^\$\{mention\}\[\[:space:\]\]\*\/\/"/u);
});

void test("agent invoke workflow fails when a successful agent run produces no push", async () => {
    const source = await readWorkflowSource("agent-invoke.yml");

    assert.match(source, /RUN_AGENT_OUTCOME: \$\{\{ steps\.run_agent\.outcome \|\| '' \}\}/u);
    assert.match(source, /RUN_AGENT_CONCLUSION: \$\{\{ steps\.run_agent\.conclusion \|\| '' \}\}/u);
    assert.match(
        source,
        /if \[ "\$\{RUN_AGENT_OUTCOME\}" = "failure" \] \|\| \[ "\$\{RUN_AGENT_CONCLUSION\}" = "failure" \]; then/u
    );
    assert.match(source, /if \[ -f "\$SENTINEL" \]; then/u);
    assert.match(source, /Agent completed without producing pushable local changes/u);
    assert.match(source, /Agent exhausted \$\{total_attempts\} attempt\(s\) without producing pushable local changes/u);
    assert.match(source, /echo "Agent command succeeded with no branch push → FAIL\."/u);
});

void test("agent invoke retries no-change local agent attempts before cleanup can run", async () => {
    const source = await readWorkflowSource("agent-invoke.yml");
    const retryStepIndex = source.indexOf("- name: Run agent custom command with retries");
    const cleanupStepIndex = source.indexOf("- name: Close empty failed agent PR");

    assert.match(source, /max_agent_retries:\n\s+type: number\n\s+required: false\n\s+default: 1/u);
    assert.ok(retryStepIndex > 0, "agent command must run from a retry-aware step.");
    assert.ok(cleanupStepIndex > retryStepIndex, "empty PR cleanup must run only after retry-aware execution.");
    assert.match(source, /MAX_AGENT_RETRIES: \$\{\{ inputs\.max_agent_retries \}\}/u);
    assert.match(source, /total_attempts=\$\(\(MAX_AGENT_RETRIES \+ 1\)\)/u);
    assert.match(source, /for \(\(attempt = 1; attempt <= total_attempts; attempt\+\+\)\); do/u);
    assert.match(source, /write_agent_prompt_file "\$\{ADDITIONAL_CONTEXT:-\}"/u);
    assert.match(source, /if \[ ! -f "\$\{AGENT_PROMPT_FILE\}" \]; then/u);
    assert.match(source, /Parent workflow failed to materialize AGENT_PROMPT_FILE/u);
    assert.doesNotMatch(source, /retry_prompt_file/u);
    assert.doesNotMatch(source, /build_attempt_context/u);
    assert.match(source, /push_current_branch_if_needed/u);
    assert.match(source, /NO_CHANGE_SENTINEL="\$\{RUNNER_TEMP:-\/tmp\}\/\.agent_no_change_retries_exhausted"/u);
    assert.match(source, /date \+"%F %T" > "\$NO_CHANGE_SENTINEL"/u);
    assert.match(source, /RETRY_COMMENT_SENTINEL="\$\{RUNNER_TEMP:-\/tmp\}\/\.agent_retry_comment_posted"/u);
    assert.match(source, /post_retry_comment_once\(\)/u);
    assert.match(source, /Retry comment already posted; skipping duplicate PR comment/u);
    assert.match(
        source,
        /did not produce pushable repository changes on attempt \$\{failed_attempt\}\/\$\{total_attempts\}/u
    );
    assert.match(source, /starting retry attempt \$\{next_attempt\}\/\$\{total_attempts\}/u);
    assert.doesNotMatch(source, /stricter command-grounded instructions/u);
    assert.match(source, /gh issue comment "\$\{PR_NUMBER\}" --body "\$\{retry_message\}" --repo "\$\{REPOSITORY\}"/u);
    assert.match(source, /post_retry_comment_once "\$\{attempt\}" "\$\(\(attempt \+ 1\)\)"/u);
    assert.match(
        source,
        /Attempt \$\{attempt\}\/\$\{total_attempts\} produced no pushable changes; starting a fresh retry session/u
    );
    assert.match(source, /reset_branch_to_retry_baseline\(\)/u);
    assert.match(source, /git reset --hard "origin\/\$\{target_ref\}"/u);
    assert.match(source, /git submodule update --init --recursive/u);
    assert.doesNotMatch(source, /- name: Auto-commit and push agent changes if needed/u);
});

void test("agent invoke closes only empty PRs on expected agent branches after reporting failure", async () => {
    const source = await readWorkflowSource("agent-invoke.yml");
    const failureCommentIndex = source.indexOf(
        'if gh issue comment "${ISSUE_NUMBER}" --body "${MESSAGE}" --repo "${REPOSITORY}"; then'
    );
    const cleanupStepIndex = source.indexOf("- name: Close empty failed agent PR");

    assert.ok(failureCommentIndex > 0, "failure path must post the failure comment.");
    assert.ok(cleanupStepIndex > failureCommentIndex, "empty PR cleanup must run after the failure comment step.");
    assert.match(source, /id: report_outcome/u);
    assert.match(source, /echo "agent_failed=\$1"/u);
    assert.match(source, /echo "cleanup_empty_pr=\$2"/u);
    assert.match(source, /write_report_outputs true true/u);
    assert.match(source, /write_report_outputs true false/u);
    assert.match(source, /write_report_outputs false false/u);
    assert.match(source, /if \[ -f "\$NO_CHANGE_SENTINEL" \]; then/u);
    assert.match(source, /if: always\(\) && steps\.report_outcome\.outputs\.cleanup_empty_pr == 'true'/u);
    assert.match(source, /repos\/\$\{REPOSITORY\}\/pulls\/\$\{ISSUE_NUMBER\}/u);
    assert.match(source, /\.changed_files/u);
    assert.match(source, /if \[ "\$\{pr_state\}" != "open" \]; then/u);
    assert.match(source, /if \[ "\$\{changed_files\}" != "0" \]; then/u);
    assert.match(
        source,
        /codex\/task-\*\|copilot\/task-\*\|gemini\/task-\*\|qwen\/task-\*\|qwen-local\/task-\*\|aider\/task-\*/u
    );
    assert.match(
        source,
        /main\|master\|develop\|development\|trunk\|production\|release\|feature\/\*\|bugfix\/\*\|hotfix\/\*/u
    );
    assert.match(source, /if \[ "\$\{head_ref\}" = "\$\{base_ref\}" \]; then/u);
    assert.match(source, /if \[ "\$\{head_repo\}" != "\$\{REPOSITORY\}" \]; then/u);
    assert.match(source, /gh pr close "\$\{ISSUE_NUMBER\}" --repo "\$\{REPOSITORY\}"/u);
    assert.match(source, /gh api -X DELETE "repos\/\$\{REPOSITORY\}\/git\/refs\/heads\/\$\{head_ref\}"/u);
    assert.match(source, /Could not post failure comment; skipping empty-agent cleanup/u);
    assert.match(source, /- name: Fail workflow after unsuccessful agent run/u);
    assert.match(source, /if: always\(\) && steps\.report_outcome\.outputs\.agent_failed == 'true'/u);
    assert.doesNotMatch(source, /git push origin --delete/u);
});

void test("agent invoke workflow checks and pushes changes after every agent attempt", async () => {
    const source = await readWorkflowSource("agent-invoke.yml");

    assert.match(source, /push_current_branch_if_needed\(\)/u);
    assert.match(source, /cd "\$\{GITHUB_WORKSPACE\}"/u);
    assert.match(source, /echo "\[agent\] Workflow working directory: \$\(pwd\)"/u);
    assert.match(source, /echo "\[agent\] Attempt working directory before agent command: \$\(pwd\)"/u);
    assert.match(source, /echo "\[agent\] Checking repository changes in: \$\(pwd\)"/u);
    assert.match(source, /echo "\[agent\] Change-check git root: \$\(git rev-parse --show-toplevel\)"/u);
    assert.match(source, /redact_git_remote_credentials\(\)/u);
    assert.match(source, /sed -E 's#\(https:\/\/\)\[\^\/@\]\+@#\\1\*\*\*@#g'/u);
    assert.match(source, /echo "\[agent\] Attempt git remotes before agent command:"/u);
    assert.match(source, /git remote -v \| redact_git_remote_credentials/u);
    assert.match(source, /echo "\[agent\] Attempt git branch before agent command: \$\(git branch --show-current\)"/u);
    assert.match(source, /echo "\[agent\] Worktree after agent attempt:"/u);
    assert.match(source, /worktree_status="\$\(git status --porcelain=v1 --untracked-files=normal\)"/u);
    assert.match(source, /if \[ -n "\$\{worktree_status\}" \]; then/u);
    assert.match(source, /is_stageable_untracked_path\(\)/u);
    assert.match(source, /cleanup_malformed_untracked_paths\(\)/u);
    assert.match(source, /stage_pushable_changes\(\)/u);
    assert.match(source, /git ls-files --others --exclude-standard/u);
    assert.match(source, /Removing malformed untracked path left by agent output/u);
    assert.match(source, /git add -u/u);
    assert.match(source, /git add -- "\$\{path\}"/u);
    assert.match(source, /Only malformed untracked files were present; nothing pushable remains/u);
    assert.match(source, /echo "\[agent\] Worktree status before staging:"/u);
    assert.match(source, /echo "\[agent\] Staged changes before commit:"/u);
    assert.match(source, /git diff --cached --stat/u);
    assert.match(source, /echo "\[agent\] Worktree status after staging:"/u);
    assert.match(source, /git status --short/u);
    assert.match(source, /git commit -m "\$commit_message"/u);
    assert.match(source, /echo "\[agent\] Staged diff after failed commit:"/u);
    assert.match(source, /echo "\[agent\] Worktree status after failed commit:"/u);
    assert.match(source, /local_head="\$\(git rev-parse HEAD\)"/u);
    assert.match(source, /remote_head="\$\(git rev-parse "\$\{remote_ref\}"\)"/u);
    assert.match(source, /elif git merge-base --is-ancestor "\$\{remote_ref\}" HEAD; then/u);
    assert.match(source, /if \[ "\$\{remote_head\}" != "\$\{local_head\}" \]; then/u);
    assert.match(source, /if ! git diff --quiet "\$\{remote_ref\}" HEAD; then/u);
    assert.match(source, /echo "\[agent\] Local branch has file changes ahead of \$\{remote_ref\}; will push\."/u);
    assert.match(source, /Local branch has commits ahead of \$\{remote_ref\}, but the net file diff is empty/u);
    assert.match(source, /elif git merge-base --is-ancestor HEAD "\$\{remote_ref\}"; then/u);
    assert.match(source, /Remote ref \$\{remote_ref\} moved ahead of local HEAD/u);
    assert.match(source, /Local branch diverged from \$\{remote_ref\}; refusing to push/u);
    assert.doesNotMatch(source, /No local commits ahead of \$\{remote_ref\}; nothing to push/u);
});

void test("agent invoke requests merge-conflict resolution with the same agent after a successful dirty push", async () => {
    const source = await readWorkflowSource("agent-invoke.yml");

    assert.match(
        source,
        /outputs:\n\s+should_request_merge_conflict_resolution: \$\{\{ steps\.evaluate_merge_conflicts\.outputs\.should_request_merge_conflict_resolution \|\| 'false' \}\}/u
    );
    assert.match(
        source,
        /follow_up_agent: \$\{\{ steps\.evaluate_merge_conflicts\.outputs\.follow_up_agent \|\| '' \}\}/u
    );
    assert.match(source, /- name: Evaluate merge conflicts after successful push/u);
    assert.match(source, /if: always\(\) && steps\.report_outcome\.outputs\.agent_failed != 'true'/u);
    assert.match(source, /FOLLOW_UP_AGENT: \$\{\{ inputs\.agent \}\}/u);
    assert.match(source, /gh api "repos\/\$\{REPOSITORY\}\/pulls\/\$\{PR_NUMBER\}"/u);
    assert.match(source, /mergeableState: \(\.mergeable_state \/\/ "unknown"\)/u);
    assert.match(source, /if \[ "\$\{mergeable_state\}" != "dirty" \]; then/u);
    assert.match(source, /requesting merge-conflict resolution with @\$\{FOLLOW_UP_AGENT\}/u);
    assert.match(source, /request_merge_conflict_resolution:/u);
    assert.match(source, /needs: invoke/u);
    assert.match(source, /if: \$\{\{ needs\.invoke\.outputs\.should_request_merge_conflict_resolution == 'true' \}\}/u);
    assert.match(source, /uses: \.\/\.github\/workflows\/agent-02-resolve-merge-conflicts\.yml/u);
    assert.match(source, /target_pr_number: \$\{\{ needs\.invoke\.outputs\.target_pr_number \}\}/u);
    assert.match(source, /agent: \$\{\{ needs\.invoke\.outputs\.follow_up_agent \}\}/u);
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
