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
