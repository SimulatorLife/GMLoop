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
}

async function readQwenSettings(): Promise<QwenSettings> {
    const source = await readFile(path.resolve(process.cwd(), ".qwen/settings.json"), "utf8");

    return JSON.parse(source) as QwenSettings;
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

function getRequiredQwenTaskPrompt(source: string): string {
    const match = /QWEN_TASK_PROMPT="\$\(cat <<'PROMPT'\n(?<prompt>[\s\S]*?)\n\s*PROMPT\n\s*\)"/u.exec(source);

    assert.ok(match?.groups?.prompt, "Qwen workflow must define a task prompt heredoc.");

    return match.groups.prompt;
}

function getRequiredAiderMessageTemplate(source: string): string {
    const match = /cat > "\$\{AIDER_TASK_MESSAGE_FILE\}" <<PROMPT\n(?<prompt>[\s\S]*?)\n\s*PROMPT/u.exec(source);

    assert.ok(match?.groups?.prompt, "Aider workflow must write a task message heredoc.");

    return match.groups.prompt;
}

function assertPromptEnforcesCommandGroundedEditLoop(prompt: string): void {
    assert.match(prompt, /pnpm run lint/u);
    assert.match(prompt, /pnpm run build:ts/u);
    assert.match(prompt, /pnpm run lint:quiet/u);
    assert.match(prompt, /command output/u);
    assert.match(prompt, /diff|worktree/u);
    assert.match(prompt, /golden .*\.gml|\.gml fixtures/u);
    assert.match(prompt, /generated files/u);
    assert.match(prompt, /dist files/u);
}

function assertQwenUsesLocalAgentLoop(source: string): void {
    const prompt = getRequiredQwenTaskPrompt(source);

    assert.match(source, /github\.event\.comment\.body == '@qwen'/u);
    assert.match(source, /startsWith\(github\.event\.comment\.body \|\| '', '@qwen '\)/u);
    assert.match(source, /uses: \.\/\.github\/workflows\/agent-invoke\.yml/u);
    assert.match(source, /agent: qwen/u);
    assert.doesNotMatch(source, /agent_cli:/u);
    assert.match(prompt, /run_shell_command/u);
    assert.match(prompt, /read_file/u);
    assert.match(prompt, /edit|write_file/u);
    assertPromptEnforcesCommandGroundedEditLoop(prompt);
    assert.doesNotMatch(prompt, /plan-only/u);
    assert.doesNotMatch(prompt, /standalone JSON/u);
    assert.match(source, /QWEN_AGENT_PROMPT="\$\(printf '%s\\n\\nUser task from PR comment:\\n%s\\n'/u);
    assert.match(source, /printf '%s\\n' "\$\{QWEN_AGENT_PROMPT\}" \| stdbuf -oL -eL qwen \\/u);
    assert.match(source, /pull_qwen_configured_model\(\)/u);
    assert.match(source, /\.qwen\/settings\.json/u);
    assert.match(source, /ollama pull "\$\{configured_model\}"/u);
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
        source.lastIndexOf("pull_qwen_configured_model") < source.lastIndexOf('printf \'%s\\n\' "${QWEN_AGENT_PROMPT}"'),
        "Qwen must pull the configured local model before invoking the real task."
    );
    assert.match(source, /agent_package: \$\{\{ vars\.QWEN_CODE_PACKAGE \|\| '@qwen-code\/qwen-code@0\.14\.5' \}\}/u);
    assert.match(source, /max_agent_retries: \$\{\{ fromJSON\(vars\.LOCAL_AGENT_MAX_RETRIES \|\| '2'\) \}\}/u);
    assert.doesNotMatch(source, /verify_qwen_/u);
    assert.doesNotMatch(source, /qwen-tool-smoke/u);
    assert.doesNotMatch(source, /qwen-file-smoke/u);
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
});

void test("aider invoke is the single local-only Aider workflow", async () => {
    const source = await readWorkflowSource("aider-invoke.yml");
    const workflowFileNames = await readdir(path.resolve(process.cwd(), ".github/workflows"));
    const prompt = getRequiredAiderMessageTemplate(source);

    assert.match(source, /name: '▶️ Aider Invoke'/u);
    assert.match(source, /github\.event\.comment\.body == '@aider'/u);
    assert.match(source, /startsWith\(github\.event\.comment\.body \|\| '', '@aider '\)/u);
    assert.match(source, /uses: \.\/\.github\/workflows\/agent-invoke\.yml/u);
    assert.match(source, /agent: aider/u);
    assert.match(source, /max_agent_retries: \$\{\{ fromJSON\(vars\.LOCAL_AGENT_MAX_RETRIES \|\| '2'\) \}\}/u);
    assert.doesNotMatch(source, /agent_cli:/u);
    assert.match(source, /pull_aider_configured_model\(\)/u);
    assert.match(source, /\.aider\.conf\.yml/u);
    assert.match(source, /ollama_model="\$\{configured_model#openai\/\}"/u);
    assert.match(source, /ollama pull "\$\{ollama_model\}"/u);
    assertPromptEnforcesCommandGroundedEditLoop(prompt);
    assert.ok(
        source.lastIndexOf("pull_aider_configured_model") < source.indexOf("AIDER_TASK_MESSAGE_FILE"),
        "Aider must pull the configured local model before invoking the CLI."
    );
    assert.match(
        source,
        /aider[\s\S]*--yes-always[\s\S]*--no-browser[\s\S]*--subtree-only[\s\S]*--no-auto-commits[\s\S]*--no-dirty-commits[\s\S]*--message-file/u
    );
    assert.match(source, /aider_status="\$\{PIPESTATUS\[0\]\}"/u);
    assert.doesNotMatch(source, /Aider completed without producing local file changes/u);
    assert.doesNotMatch(source, /OPENAI_API_TYPE/u);
    assert.doesNotMatch(source, /@aider-local/u);
    assert.doesNotMatch(source, /--model/u);
    assert.ok(!workflowFileNames.includes("aider-local-code-tasks.yml"));
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

    assert.match(source, /- name: Run agent custom command with retries/u);
    assert.match(source, /stdbuf -oL -eL bash "\$script" 2>&1 \| tee "\$\{attempt_log\}"/u);
    assert.match(source, /agent_status="\$\{PIPESTATUS\[0\]\}"/u);
    assert.match(source, /return "\$\{agent_status\}"/u);
    assert.match(source, /cp "\$\{attempt_log\}" "\$RUNNER_TEMP\/agent-live\.log"/u);
});

void test("agent invoke workflow fails when a successful agent run produces no push", async () => {
    const source = await readWorkflowSource("agent-invoke.yml");

    assert.match(source, /if \[ "\$\{\{ steps\.run_agent\.outcome \}\}" = "failure" \] \|\| \[ "\$\{\{ steps\.run_agent\.conclusion \}\}" = "failure" \]; then/u);
    assert.match(source, /if \[ -f "\$SENTINEL" \]; then/u);
    assert.match(source, /Agent completed without producing pushable local changes/u);
    assert.match(source, /Agent exhausted \$\{total_attempts\} attempt\(s\) without producing pushable local changes/u);
    assert.match(source, /echo "Agent command succeeded with no branch push → FAIL\."/u);
});

void test("agent invoke retries no-change local agent attempts before cleanup can run", async () => {
    const source = await readWorkflowSource("agent-invoke.yml");
    const retryStepIndex = source.indexOf("- name: Run agent custom command with retries");
    const cleanupStepIndex = source.indexOf("- name: Close empty failed agent PR");

    assert.match(source, /max_agent_retries:\n\s+type: number\n\s+required: false\n\s+default: 2/u);
    assert.ok(retryStepIndex > 0, "agent command must run from a retry-aware step.");
    assert.ok(cleanupStepIndex > retryStepIndex, "empty PR cleanup must run only after retry-aware execution.");
    assert.match(source, /MAX_AGENT_RETRIES: \$\{\{ inputs\.max_agent_retries \}\}/u);
    assert.match(source, /total_attempts=\$\(\(MAX_AGENT_RETRIES \+ 1\)\)/u);
    assert.match(source, /for \(\(attempt = 1; attempt <= total_attempts; attempt\+\+\)\); do/u);
    assert.match(source, /The previous attempt was invalid because it completed without producing any pushable repository changes/u);
    assert.match(source, /Work in the checked-out repository, not uploaded chat snippets/u);
    assert.match(source, /run `pnpm run lint` before code selection/u);
    assert.match(source, /quote the exact lint summary line/u);
    assert.match(source, /If no concrete diff is produced, this retry will fail/u);
    assert.match(source, /ADDITIONAL_CONTEXT="\$\(build_attempt_context "\$\{attempt\}"\)"/u);
    assert.match(source, /push_current_branch_if_needed/u);
    assert.match(source, /NO_CHANGE_SENTINEL="\$\{RUNNER_TEMP:-\/tmp\}\/\.agent_no_change_retries_exhausted"/u);
    assert.match(source, /date \+"%F %T" > "\$NO_CHANGE_SENTINEL"/u);
    assert.match(source, /Attempt \$\{attempt\}\/\$\{total_attempts\} produced no pushable changes; starting a fresh retry session/u);
    assert.doesNotMatch(source, /- name: Auto-commit and push agent changes if needed/u);
});

void test("agent invoke closes only empty PRs on expected agent branches after reporting failure", async () => {
    const source = await readWorkflowSource("agent-invoke.yml");
    const failureCommentIndex = source.indexOf('if gh issue comment "${ISSUE_NUMBER}" --body "${MESSAGE}" --repo "${REPOSITORY}"; then');
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
    assert.match(source, /codex\/task-\*\|copilot\/task-\*\|gemini\/task-\*\|qwen\/task-\*\|qwen-local\/task-\*\|aider\/task-\*/u);
    assert.match(source, /main\|master\|develop\|development\|trunk\|production\|release\|feature\/\*\|bugfix\/\*\|hotfix\/\*/u);
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
    assert.match(source, /echo "\[agent\] Worktree after agent attempt:"/u);
    assert.match(source, /worktree_status="\$\(git status --porcelain=v1 --untracked-files=normal\)"/u);
    assert.match(source, /if \[ -n "\$\{worktree_status\}" \]; then/u);
    assert.match(source, /git add -A/u);
    assert.match(source, /git commit -m "\$commit_message"/u);
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
