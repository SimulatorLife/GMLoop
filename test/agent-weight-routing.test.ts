import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

type WeightedAgent = Readonly<{
    name: string;
    weight: number;
}>;

type AgentPool = Readonly<{
    default: string;
    agents: ReadonlyArray<WeightedAgent>;
}>;

type WorkflowWeight = Readonly<{
    name: string;
    weight: number;
}>;

type AgentWeightsConfig = Readonly<{
    version: number;
    agentPools: Readonly<Record<string, AgentPool>>;
    workflows: ReadonlyArray<WorkflowWeight>;
}>;

type DeterministicWeightedCandidate = Readonly<{
    name: string;
    weight: number;
}>;

type DeterministicWeightedSelection = Readonly<{
    name: string;
    cycleIndex: number;
    cycleLength: number;
}>;

const WEIGHT_SCALE = 1000;

async function readAgentWeightsConfig(): Promise<AgentWeightsConfig> {
    const weightsPath = path.resolve(process.cwd(), ".github/workflows/weights.json");
    const source = await readFile(weightsPath, "utf8");

    return JSON.parse(source) as AgentWeightsConfig;
}

function toSlots(weight: number): number {
    return Math.max(1, Math.round(weight * WEIGHT_SCALE));
}

function selectDeterministicWeightedCandidate(
    candidates: ReadonlyArray<DeterministicWeightedCandidate>,
    runNumber: number
): DeterministicWeightedSelection | null {
    const eligibleCandidates = candidates
        .filter((candidate) => Number.isFinite(candidate.weight) && candidate.weight > 0)
        .map((candidate) => ({
            name: candidate.name,
            weight: candidate.weight,
            slots: toSlots(candidate.weight)
        }))
        .sort((left, right) => left.name.localeCompare(right.name));

    if (eligibleCandidates.length === 0) {
        return null;
    }

    const maxSlots = Math.max(...eligibleCandidates.map((candidate) => candidate.slots));
    const cycle: string[] = [];
    for (let slot = 1; slot <= maxSlots; slot += 1) {
        for (const candidate of eligibleCandidates) {
            if (candidate.slots >= slot) {
                cycle.push(candidate.name);
            }
        }
    }

    const cycleIndex = (runNumber - 1) % cycle.length;
    return {
        name: cycle[cycleIndex],
        cycleIndex: cycleIndex + 1,
        cycleLength: cycle.length
    };
}

function assertPoolCanSelectAgent(poolName: string, pool: AgentPool): void {
    assert.equal(typeof pool.default, "string", `${poolName} pool should define a default agent.`);
    assert.notEqual(pool.default.trim(), "", `${poolName} pool default should not be empty.`);
    assert.ok(Array.isArray(pool.agents), `${poolName} pool should define weighted agents.`);

    const selectableAgents = pool.agents.filter((agent) => Number.isFinite(agent.weight) && agent.weight > 0);

    assert.ok(
        selectableAgents.length > 0 || pool.default.trim().length > 0,
        `${poolName} pool should have a positive-weight agent or default fallback.`
    );
}

void test("agent weights separate initial actions from follow-up routing pools", async () => {
    const config = await readAgentWeightsConfig();

    assert.equal(config.version, 1);
    assert.equal(Object.hasOwn(config, "agents"), false, "legacy top-level agents array should be removed.");

    assertPoolCanSelectAgent("actions", config.agentPools.actions);
    assertPoolCanSelectAgent("followUps", config.agentPools.followUps);

    assert.equal(config.agentPools.actions.default, "codex");
    assert.equal(config.agentPools.followUps.default, "copilot");
});

void test("scheduler still has weighted workflows after agent pool migration", async () => {
    const config = await readAgentWeightsConfig();
    const workflowNames = new Set(config.workflows.map((workflow) => workflow.name));

    assert.ok(config.workflows.length > 0, "scheduler should have workflows to dispatch.");
    assert.ok(workflowNames.has("agent-02-resolve-merge-conflicts"));
    assert.ok(workflowNames.has("agent-41-test-failure"));
    assert.ok(workflowNames.has("agent-104-test-deduplication"));
    assert.ok(workflowNames.has("agent-105-semantic-graph-fidelity"));
    assert.ok(workflowNames.has("agent-106-bad-test-remediation"));
});

void test("workflows use task-specific agent pools", async () => {
    const openPrWorkflow = await readFile(
        path.resolve(process.cwd(), ".github/workflows/_agent-open-pr-and-ping.yml"),
        "utf8"
    );
    const conflictWorkflow = await readFile(
        path.resolve(process.cwd(), ".github/workflows/agent-02-resolve-merge-conflicts.yml"),
        "utf8"
    );
    const automergeWorkflow = await readFile(
        path.resolve(process.cwd(), ".github/workflows/automerge-prs.yml"),
        "utf8"
    );

    assert.match(openPrWorkflow, /const ACTION_AGENT_POOL = 'actions';/u);
    assert.match(openPrWorkflow, /selectAgent\(ACTION_AGENT_POOL, requested\)/u);

    assert.match(conflictWorkflow, /const FOLLOW_UP_AGENT_POOL = "followUps";/u);
    assert.match(conflictWorkflow, /selectAgent\(FOLLOW_UP_AGENT_POOL, rawAgent\)/u);

    assert.match(automergeWorkflow, /const FOLLOW_UP_AGENT_POOL = 'followUps';/u);
    assert.match(automergeWorkflow, /selectAgent\(FOLLOW_UP_AGENT_POOL, ''\)/u);
    assert.doesNotMatch(automergeWorkflow, /No agent prefix found on branch name/u);
});

void test("merge conflict workflow supports reusable invocations with explicit PR and agent inputs", async () => {
    const conflictWorkflow = await readFile(
        path.resolve(process.cwd(), ".github/workflows/agent-02-resolve-merge-conflicts.yml"),
        "utf8"
    );

    assert.match(conflictWorkflow, /workflow_call:/u);
    assert.match(
        conflictWorkflow,
        /target_pr_number:\n\s+description: "Optional PR number to target for conflict resolution\."\n\s+required: false/u
    );
    assert.match(conflictWorkflow, /agent:\n\s+description: "Optional agent override\."\n\s+required: false/u);
    assert.match(conflictWorkflow, /GH_USER_TOKEN:\n\s+required: true/u);
    assert.match(
        conflictWorkflow,
        /TARGET_PR_NUMBER_INPUT: \$\{\{ inputs\.target_pr_number \|\| github\.event\.inputs\.target_pr_number \|\| '' \}\}/u
    );
    assert.match(
        conflictWorkflow,
        /const manualRun = context\.eventName === "workflow_dispatch" && manualInput\.length > 0;/u
    );
    assert.match(conflictWorkflow, /AGENT: \$\{\{ inputs\.agent \|\| github\.event\.inputs\.agent \|\| '' \}\}/u);
    assert.match(conflictWorkflow, /with:\n\s+github-token: \$\{\{ secrets\.GH_USER_TOKEN \}\}\n\s+script: \|/u);
    assert.match(conflictWorkflow, /const lines = \[\n\s+marker,/u);
    assert.match(
        conflictWorkflow,
        /const lines = \[[\s\S]*?\n\s+`\$\{mention\} This PR currently has merge conflicts/u
    );
});

void test("workflow selectors use deterministic run-number weighted selection", async () => {
    const schedulerWorkflow = await readFile(path.resolve(process.cwd(), ".github/workflows/_scheduler.yml"), "utf8");
    const openPrWorkflow = await readFile(
        path.resolve(process.cwd(), ".github/workflows/_agent-open-pr-and-ping.yml"),
        "utf8"
    );
    const conflictWorkflow = await readFile(
        path.resolve(process.cwd(), ".github/workflows/agent-02-resolve-merge-conflicts.yml"),
        "utf8"
    );
    const automergeWorkflow = await readFile(
        path.resolve(process.cwd(), ".github/workflows/automerge-prs.yml"),
        "utf8"
    );

    for (const workflowSource of [schedulerWorkflow, openPrWorkflow, conflictWorkflow, automergeWorkflow]) {
        assert.match(workflowSource, /const WEIGHT_SCALE = 1000;/u);
        assert.match(workflowSource, /process\.env\.GITHUB_RUN_NUMBER/u);
        assert.match(workflowSource, /chooseDeterministicWeighted/u);
        assert.match(workflowSource, /Deterministic weighted selection/u);
        assert.doesNotMatch(workflowSource, /randomBytes/u);
    }
});

void test("deterministic weighted selector alternates equal-weight candidates", () => {
    const candidates = [
        { name: "codex", weight: 1 },
        { name: "copilot", weight: 1 }
    ] as const;
    const picks = Array.from(
        { length: 6 },
        (_, index) => selectDeterministicWeightedCandidate(candidates, index + 1)?.name
    );

    assert.deepEqual(picks, ["codex", "copilot", "codex", "copilot", "codex", "copilot"]);
});

void test("deterministic weighted selector respects unequal weights", () => {
    const candidates = [
        { name: "codex", weight: 2 },
        { name: "copilot", weight: 1 }
    ] as const;
    const picks = Array.from(
        { length: 3000 },
        (_, index) => selectDeterministicWeightedCandidate(candidates, index + 1)?.name
    );
    const codexCount = picks.filter((name) => name === "codex").length;
    const copilotCount = picks.filter((name) => name === "copilot").length;

    assert.equal(codexCount, 2000);
    assert.equal(copilotCount, 1000);
});

void test("deterministic weighted selector excludes non-positive weights", () => {
    const selection = selectDeterministicWeightedCandidate(
        [
            { name: "codex", weight: 0 },
            { name: "copilot", weight: -1 },
            { name: "gemini", weight: 1 }
        ],
        3
    );

    assert.notEqual(selection, null);
    assert.equal(selection?.name, "gemini");
    assert.equal(selection?.cycleIndex, 3);
    assert.equal(selection?.cycleLength, 1000);
});

void test("failing test recovery probes the full validation surface before opening a PR", async () => {
    const workflow = await readFile(path.resolve(process.cwd(), ".github/workflows/agent-41-test-failure.yml"), "utf8");

    assert.match(workflow, /validation_failed: \$\{\{ steps\.run_validation\.outputs\.failed \}\}/u);
    assert.match(workflow, /needs\.check_validation\.outputs\.validation_failed == 'true'/u);
    assert.match(workflow, /pnpm run build:ts/u);
    assert.match(workflow, /pnpm run lint:quiet/u);
    assert.match(workflow, /pnpm run test:ci/u);
    assert.match(workflow, /pnpm run test:performance/u);
    assert.doesNotMatch(workflow, /tests_failed/u);
});

void test("test deduplication workflow protects edge coverage while consolidating redundant tests", async () => {
    const workflow = await readFile(
        path.resolve(process.cwd(), ".github/workflows/agent-104-test-deduplication.yml"),
        "utf8"
    );

    assert.match(workflow, /Find exactly one small cluster of duplicate or near-duplicate unit tests/u);
    assert.match(workflow, /Preserve edge-case coverage\./u);
    assert.match(workflow, /If you are not confident the cases are truly redundant, do not combine them\./u);
    assert.match(workflow, /shared helper, table-driven structure, or a single stronger assertion shape/u);
    assert.match(workflow, /validation commands you ran to confirm coverage was preserved/u);
});

void test("semantic graph fidelity workflow combines graph correctness with viewer readability", async () => {
    const workflow = await readFile(
        path.resolve(process.cwd(), ".github/workflows/agent-105-semantic-graph-fidelity.yml"),
        "utf8"
    );

    assert.match(workflow, /Focus on both semantic graph correctness and graph viewer UX\/readability/u);
    assert.match(workflow, /project's real nodes, asset\/resource kinds, variables, symbols, and relationships/u);
    assert.match(workflow, /graph model, export, or viewer surface should own the fix/u);
    assert.match(workflow, /semantic owns graph\/index\/query truth, CLI owns graph visualization\/export surfaces/u);
    assert.match(workflow, /correct identity, connection semantics, and readable presentation/u);
});

void test("bad test remediation workflow targets fragile tests and strengthens contract-focused assertions", async () => {
    const workflow = await readFile(
        path.resolve(process.cwd(), ".github/workflows/agent-106-bad-test-remediation.yml"),
        "utf8"
    );

    assert.match(
        workflow,
        /Identify one genuinely bad automated test or one small cluster of closely related bad tests/u
    );
    assert.match(workflow, /assert implementation details instead of externally visible behavior/u);
    assert.match(
        workflow,
        /depend on test execution order, global state, timing, randomness, or the current environment/u
    );
    assert.match(workflow, /Prefer stronger contract-focused assertions, clearer setup, and deterministic behavior/u);
    assert.match(workflow, /why the original test was "bad", explain the new contract-focused shape/u);
});
