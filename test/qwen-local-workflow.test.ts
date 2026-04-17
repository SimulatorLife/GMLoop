import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function readQwenLocalWorkflow(): Promise<string> {
    return readFile(path.resolve(process.cwd(), ".github/workflows/qwen-local-code-tasks.yml"), "utf8");
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
    assert.match(source, /git config --local user\.name "github-actions\[bot\]"/u);
    assert.match(source, /git config --local user\.email "41898282\+github-actions\[bot\]@users\.noreply\.github\.com"/u);
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
