import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

type TaskCategory = "code" | "merging" | "regressions";

type WeightedAgent = Readonly<{
    name: string;
    weight: number;
}>;

type AgentPool = Readonly<{
    default: string;
    agents: ReadonlyArray<WeightedAgent>;
}>;

type ScheduledAgent = Readonly<{
    name: string;
    weight: number;
    cadenceTicks?: number;
    category: ReadonlyArray<TaskCategory>;
    minComplexity?: number;
    maxComplexity?: number;
}>;

type WorkflowWeight = Readonly<{
    name: string;
    weight: number;
    category: TaskCategory;
    complexity: number;
}>;

type AgentWeightsConfig = Readonly<{
    agents: ReadonlyArray<ScheduledAgent>;
    agentPools: Readonly<{
        followUps: AgentPool;
    }>;
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

type WorkflowAgentPairCandidate = Readonly<{
    workflowName: string;
    agentName: string;
    workflowCategory: TaskCategory;
    weight: number;
}>;

const WEIGHT_SCALE = 1000;
const TASK_CATEGORIES = new Set<TaskCategory>(["code", "merging", "regressions"]);

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

function isAgentDue(agent: ScheduledAgent, runNumber: number): boolean {
    return runNumber % (agent.cadenceTicks ?? 1) === 0;
}

function isWorkflowEligibleForAgent(workflow: WorkflowWeight, agent: ScheduledAgent): boolean {
    if (!agent.category.includes(workflow.category)) {
        return false;
    }

    if (agent.minComplexity !== undefined && workflow.complexity < agent.minComplexity) {
        return false;
    }

    if (agent.maxComplexity !== undefined && workflow.complexity > agent.maxComplexity) {
        return false;
    }

    return true;
}

function buildEligibleWorkflowAgentPairCandidates(
    config: AgentWeightsConfig,
    runNumber: number
): ReadonlyArray<WorkflowAgentPairCandidate> {
    const candidates: WorkflowAgentPairCandidate[] = [];

    for (const agent of config.agents) {
        if (!isAgentDue(agent, runNumber) || agent.weight <= 0) {
            continue;
        }

        for (const workflow of config.workflows) {
            if (workflow.weight <= 0 || !isWorkflowEligibleForAgent(workflow, agent)) {
                continue;
            }

            candidates.push({
                workflowName: workflow.name,
                agentName: agent.name,
                workflowCategory: workflow.category,
                weight: workflow.weight * agent.weight
            });
        }
    }

    return candidates;
}

void test("agent weights separate scheduled agents from follow-up routing pools", async () => {
    const config = await readAgentWeightsConfig();

    assert.ok(Object.hasOwn(config, "agents"), "scheduled routing should use a top-level agents array.");
    assert.equal(Object.hasOwn(config.agentPools, "actions"), false, "legacy actions pool should be removed.");
    assert.ok(Object.hasOwn(config.agentPools, "followUps"), "follow-up routing should use a followUps pool.");
    assert.ok(config.agents.length > 0, "scheduled routing should define agents.");
    assertPoolCanSelectAgent("followUps", config.agentPools.followUps);
});

void test("scheduled workflows declare explicit task category and complexity", async () => {
    const config = await readAgentWeightsConfig();
    const workflowNames = new Set(config.workflows.map((workflow) => workflow.name));
    const scheduledAgentNames = new Set(config.agents.map((agent) => agent.name));

    assert.ok(config.workflows.length > 0, "scheduler should have workflows to dispatch.");
    assert.ok(workflowNames.has("agent-02-resolve-merge-conflicts"));
    assert.ok(workflowNames.has("agent-41-test-failure"));
    assert.ok(workflowNames.has("agent-104-test-deduplication"));
    assert.ok(workflowNames.has("agent-105-semantic-graph-fidelity"));
    assert.ok(workflowNames.has("agent-106-bad-test-remediation"));

    assert.ok(scheduledAgentNames.has("copilot"));
    assert.ok(scheduledAgentNames.has("codex"));
    assert.ok(scheduledAgentNames.has("qwen"));
    assert.ok(scheduledAgentNames.has("gemini"));
    assert.ok(scheduledAgentNames.has("mini-max"));

    for (const workflow of config.workflows) {
        assert.ok(TASK_CATEGORIES.has(workflow.category), `${workflow.name} should declare a valid task category.`);
        assert.equal(
            Number.isInteger(workflow.complexity),
            true,
            `${workflow.name} should declare integer complexity.`
        );
        assert.ok(workflow.complexity >= 1 && workflow.complexity <= 3, `${workflow.name} should use complexity 1..3.`);
    }

    for (const agent of config.agents) {
        if (agent.minComplexity !== undefined) {
            assert.equal(
                Number.isInteger(agent.minComplexity),
                true,
                `${agent.name} minComplexity should be an integer.`
            );
            assert.ok(
                agent.minComplexity >= 1 && agent.minComplexity <= 3,
                `${agent.name} minComplexity should use 1..3.`
            );
        }

        if (agent.maxComplexity !== undefined) {
            assert.equal(
                Number.isInteger(agent.maxComplexity),
                true,
                `${agent.name} maxComplexity should be an integer.`
            );
            assert.ok(
                agent.maxComplexity >= 1 && agent.maxComplexity <= 3,
                `${agent.name} maxComplexity should use 1..3.`
            );
        }
    }
});

void test("scheduled agents keep qwen and gemini out of merging and regressions", async () => {
    const config = await readAgentWeightsConfig();
    const qwen = config.agents.find((agent) => agent.name === "qwen");
    const gemini = config.agents.find((agent) => agent.name === "gemini");

    assert.notEqual(qwen, undefined);
    assert.notEqual(gemini, undefined);

    assert.deepEqual(qwen?.category, ["code"]);
    assert.deepEqual(gemini?.category, ["code"]);
});

void test("scheduled agents may omit cadenceTicks and default to every run", () => {
    const config: AgentWeightsConfig = {
        agents: [
            {
                name: "copilot",
                weight: 1,
                category: ["code", "merging", "regressions"]
            },
            {
                name: "mini-max",
                weight: 0.5,
                cadenceTicks: 2,
                category: ["code"],
                maxComplexity: 2
            }
        ],
        agentPools: {
            followUps: {
                default: "copilot",
                agents: [{ name: "copilot", weight: 1 }]
            }
        },
        workflows: [{ name: "agent-04-style", weight: 0.2, category: "code", complexity: 1 }]
    };

    const runOneCandidates = buildEligibleWorkflowAgentPairCandidates(config, 1);
    const runTwoCandidates = buildEligibleWorkflowAgentPairCandidates(config, 2);

    assert.deepEqual(
        runOneCandidates.map((candidate) => `${candidate.workflowName}:${candidate.agentName}`),
        ["agent-04-style:copilot"]
    );
    assert.deepEqual(
        runTwoCandidates.map((candidate) => `${candidate.workflowName}:${candidate.agentName}`),
        ["agent-04-style:copilot", "agent-04-style:mini-max"]
    );
});

void test("workflows use scheduled agents for initial actions and followUps for follow-up routing", async () => {
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

    assert.doesNotMatch(openPrWorkflow, /const ACTION_AGENT_POOL = 'actions';/u);
    assert.match(openPrWorkflow, /weights\.json must define a top-level agents array\./u);
    assert.match(openPrWorkflow, /parseScheduledAgentCandidates\(parsed\?\.agents\)/u);
    assert.match(openPrWorkflow, /const selection = selectAgent\(requested\);/u);

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

void test("workflow selectors use deterministic weighted selection without randomness", async () => {
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

    for (const workflowSource of [openPrWorkflow, conflictWorkflow, automergeWorkflow]) {
        assert.match(workflowSource, /const WEIGHT_SCALE = 1000;/u);
        assert.match(workflowSource, /process\.env\.GITHUB_RUN_NUMBER/u);
        assert.match(workflowSource, /chooseDeterministicWeighted/u);
        assert.match(workflowSource, /Deterministic weighted selection/u);
        assert.doesNotMatch(workflowSource, /randomBytes/u);
    }

    assert.match(schedulerWorkflow, /const WEIGHT_SCALE = 1000;/u);
    assert.match(schedulerWorkflow, /process\.env\.GITHUB_RUN_NUMBER/u);
    assert.match(schedulerWorkflow, /chooseDeterministicWeighted/u);
    assert.match(schedulerWorkflow, /Deterministic weighted selection/u);
    assert.doesNotMatch(schedulerWorkflow, /randomBytes/u);
});

void test("scheduler selects workflow and agent pairs and dispatches the selected agent input", async () => {
    const schedulerWorkflow = await readFile(path.resolve(process.cwd(), ".github/workflows/_scheduler.yml"), "utf8");

    assert.match(schedulerWorkflow, /const TASK_CATEGORIES = new Set\(\["code", "merging", "regressions"\]\);/u);
    assert.match(schedulerWorkflow, /- cron: "\*\/15 \* \* \* \*"/u);
    assert.match(schedulerWorkflow, /const assertComplexityRange = \(value, label\) => \{/u);
    assert.match(schedulerWorkflow, /must be between 1 and 3 inclusive\./u);
    assert.match(
        schedulerWorkflow,
        /const cadenceTicks = rawCadenceTicks === undefined \? 1 : Number\(rawCadenceTicks\);/u
    );
    assert.match(schedulerWorkflow, /runNumber % agent\.cadenceTicks === 0/u);
    assert.match(schedulerWorkflow, /workflow\.weight \* agent\.weight/u);
    assert.match(schedulerWorkflow, /inputs:\s*\{\s*agent: agentName,/u);
    assert.match(schedulerWorkflow, /No eligible workflow\/agent pairs are due/u);
});

void test("blank manual dispatch keeps explicit manual override and otherwise uses scheduled agents", async () => {
    const openPrWorkflow = await readFile(
        path.resolve(process.cwd(), ".github/workflows/_agent-open-pr-and-ping.yml"),
        "utf8"
    );

    assert.match(openPrWorkflow, /if \(requestedAgent\) \{/u);
    assert.match(openPrWorkflow, /agent: requestedAgent,/u);
    assert.match(
        openPrWorkflow,
        /const cadenceTicks = rawCadenceTicks === undefined \? 1 : Number\(rawCadenceTicks\);/u
    );
    assert.match(openPrWorkflow, /No positive-weight scheduled agents are configured for blank manual dispatch\./u);
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

void test("scheduled pair eligibility respects cadence, category, complexity, and non-positive weights", () => {
    const config: AgentWeightsConfig = {
        agents: [
            {
                name: "copilot",
                weight: 1,
                cadenceTicks: 4,
                category: ["code", "merging", "regressions"]
            },
            {
                name: "codex",
                weight: 1,
                cadenceTicks: 4,
                category: ["code"],
                minComplexity: 3
            },
            {
                name: "mini-max",
                weight: 0.5,
                cadenceTicks: 2,
                category: ["code"],
                maxComplexity: 2
            },
            {
                name: "qwen",
                weight: 0,
                cadenceTicks: 2,
                category: ["code"],
                maxComplexity: 2
            }
        ],
        agentPools: {
            followUps: {
                default: "copilot",
                agents: [{ name: "copilot", weight: 1 }]
            }
        },
        workflows: [
            { name: "agent-02-resolve-merge-conflicts", weight: 1, category: "merging", complexity: 3 },
            { name: "agent-04-style", weight: 0.2, category: "code", complexity: 1 },
            { name: "agent-23-lint", weight: 0.33, category: "code", complexity: 3 },
            { name: "agent-41-test-failure", weight: 0.5, category: "regressions", complexity: 3 },
            { name: "agent-88-lsp", weight: 0, category: "code", complexity: 3 }
        ]
    };

    const runTwoCandidates = buildEligibleWorkflowAgentPairCandidates(config, 2);
    const runFourCandidates = buildEligibleWorkflowAgentPairCandidates(config, 4);

    assert.deepEqual(
        runTwoCandidates.map((candidate) => `${candidate.workflowName}:${candidate.agentName}`),
        ["agent-04-style:mini-max"]
    );

    assert.deepEqual(
        runFourCandidates.map((candidate) => `${candidate.workflowName}:${candidate.agentName}`),
        [
            "agent-02-resolve-merge-conflicts:copilot",
            "agent-04-style:copilot",
            "agent-23-lint:copilot",
            "agent-41-test-failure:copilot",
            "agent-23-lint:codex",
            "agent-04-style:mini-max"
        ]
    );
});

void test("configured workflow complexities stay within the locked 1..3 range", async () => {
    const config = await readAgentWeightsConfig();
    const outOfRangeWorkflows = config.workflows.filter(
        (workflow) => workflow.complexity < 1 || workflow.complexity > 3
    );

    assert.deepEqual(outOfRangeWorkflows, []);
});

void test("configured scheduled agents do not create merging or regressions routes for qwen or gemini", async () => {
    const config = await readAgentWeightsConfig();
    const qwen = config.agents.find((agent) => agent.name === "qwen");
    const gemini = config.agents.find((agent) => agent.name === "gemini");

    assert.notEqual(qwen, undefined);
    assert.notEqual(gemini, undefined);

    const positiveWeightConfig: AgentWeightsConfig = {
        ...config,
        agents: config.agents.map((agent) => {
            if (agent.name === "qwen" || agent.name === "gemini") {
                return { ...agent, weight: 1 };
            }
            return { ...agent };
        })
    };

    const runFourCandidates = buildEligibleWorkflowAgentPairCandidates(positiveWeightConfig, 4);
    const qwenOrGeminiNonCodeCandidates = runFourCandidates.filter(
        (candidate) =>
            (candidate.agentName === "qwen" || candidate.agentName === "gemini") &&
            candidate.workflowCategory !== "code"
    );

    assert.deepEqual(qwen?.category, ["code"]);
    assert.deepEqual(gemini?.category, ["code"]);
    assert.deepEqual(qwenOrGeminiNonCodeCandidates, []);
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
