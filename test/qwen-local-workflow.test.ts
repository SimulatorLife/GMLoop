import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function readQwenLocalWorkflow(): Promise<string> {
    return readFile(path.resolve(process.cwd(), ".github/workflows/qwen-local-code-tasks.yml"), "utf8");
}

async function readAllWorkflowSources(): Promise<string> {
    const workflowDirectory = path.resolve(process.cwd(), ".github/workflows");
    const directoryEntries = await readdir(workflowDirectory);
    const workflowFileNames = directoryEntries.filter((fileName) => fileName.endsWith(".yml") || fileName.endsWith(".yaml"));
    const workflowSources = await Promise.all(
        workflowFileNames.map(async (fileName) => {
            const source = await readFile(path.join(workflowDirectory, fileName), "utf8");

            return `# ${fileName}\n${source}`;
        })
    );

    return workflowSources.join("\n");
}

void test("qwen local workflow configures git identity before Qwen checkpointing", async () => {
    const source = await readQwenLocalWorkflow();
    const gitIdentityStepIndex = source.indexOf("Configure Git author for Qwen checkpoints");
    const qwenRunStepIndex = source.indexOf("Run Qwen against local model");

    assert.notEqual(
        gitIdentityStepIndex,
        -1,
        "workflow should configure a git author for Qwen checkpoint commits."
    );
    assert.notEqual(qwenRunStepIndex, -1, "workflow should still run Qwen against the local model.");
    assert.ok(gitIdentityStepIndex < qwenRunStepIndex, "git author configuration must happen before Qwen starts.");
    assert.match(source, /GIT_AUTHOR_NAME: "github-actions\[bot\]"/u);
    assert.match(source, /GIT_AUTHOR_EMAIL: "41898282\+github-actions\[bot\]@users\.noreply\.github\.com"/u);
    assert.match(source, /GIT_COMMITTER_NAME: "github-actions\[bot\]"/u);
    assert.match(source, /GIT_COMMITTER_EMAIL: "41898282\+github-actions\[bot\]@users\.noreply\.github\.com"/u);
    assert.match(source, /git config --global user\.name "\$GIT_COMMITTER_NAME"/u);
    assert.match(source, /git config --global user\.email "\$GIT_COMMITTER_EMAIL"/u);
    assert.match(source, /git config --local user\.name "\$GIT_COMMITTER_NAME"/u);
    assert.match(source, /git config --local user\.email "\$GIT_COMMITTER_EMAIL"/u);
});

void test("qwen local workflow validates generated changes after cleanup", async () => {
    const source = await readQwenLocalWorkflow();
    const validationStepIndex = source.indexOf("Validate generated changes");
    const cleanupStepIndex = source.indexOf("Run local formatting and linting");

    assert.notEqual(cleanupStepIndex, -1, "workflow should still clean up generated output.");
    assert.ok(validationStepIndex > cleanupStepIndex, "validation should run after formatting and lint fixes.");
    assert.match(source, /pnpm run build:ts/u);
    assert.match(source, /pnpm run lint:quiet/u);
});

void test("qwen local workflow reads Node and pnpm versions from repository sources", async () => {
    const source = await readQwenLocalWorkflow();

    assert.match(source, /Read Node version from \.nvmrc/u);
    assert.match(source, /echo "version=\$\(cat \.nvmrc\)" >> "\$GITHUB_OUTPUT"/u);
    assert.match(source, /Read pnpm version from package\.json/u);
    assert.match(source, /packageManager\.split\('@'\)\[1\]/u);
    assert.match(source, /version: \$\{\{ steps\.pnpm-version\.outputs\.version \}\}/u);
    assert.match(source, /uses: actions\/setup-node@v6/u);
    assert.match(source, /node-version: \$\{\{ steps\.node-version\.outputs\.version \}\}/u);
    assert.doesNotMatch(source, /version: 10\.32\.1/u);
    assert.doesNotMatch(source, /node-version: "22"/u);
});

void test("GitHub workflows do not hardcode repository Node or pnpm versions", async () => {
    const source = await readAllWorkflowSources();

    assert.doesNotMatch(source, /^\s*version:\s*10\.32\.1\s*$/mu);
    assert.doesNotMatch(source, /^\s*node-version:\s*["']?22["']?\s*$/mu);
    assert.doesNotMatch(source, /pnpm@10\.32\.1/u);
});

void test("qwen local workflow only starts Ollama when the API is not already running", async () => {
    const source = await readQwenLocalWorkflow();

    assert.match(source, /curl -fsS http:\/\/127\.0\.0\.1:11434\/api\/version/u);
    assert.match(source, /if ! curl -fsS http:\/\/127\.0\.0\.1:11434\/api\/version/u);
    assert.match(source, /ollama serve > ollama\.log 2>&1 &/u);
    assert.match(source, /for attempt in \{1\.\.30\}; do/u);
});
