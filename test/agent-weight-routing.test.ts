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

async function readAgentWeightsConfig(): Promise<AgentWeightsConfig> {
    const weightsPath = path.resolve(process.cwd(), ".github/workflows/weights.json");
    const source = await readFile(weightsPath, "utf8");

    return JSON.parse(source) as AgentWeightsConfig;
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

void test("failing test recovery probes the full validation surface before opening a PR", async () => {
    const workflow = await readFile(
        path.resolve(process.cwd(), ".github/workflows/agent-41-test-failure.yml"),
        "utf8"
    );

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

    assert.match(workflow, /Identify one genuinely bad automated test or one small cluster of closely related bad tests/u);
    assert.match(workflow, /assert implementation details instead of externally visible behavior/u);
    assert.match(workflow, /depend on test execution order, global state, timing, randomness, or the current environment/u);
    assert.match(workflow, /Prefer stronger contract-focused assertions, clearer setup, and deterministic behavior/u);
    assert.match(workflow, /why the original test was "bad", explain the new contract-focused shape/u);
});
