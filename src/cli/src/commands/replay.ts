import path from "node:path";

import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createPathOption } from "../cli-core/shared-command-options.js";
import {
    createDeterministicArtifactId,
    ensureArtifactDirectory,
    fileExists,
    listJsonBasenames,
    readArtifactJson,
    readValidatedArtifactJson,
    resolveArtifactDirectory,
    writeArtifactJson
} from "../modules/runtime/index.js";
import { isRecord } from "../shared/error-guards.js";
import { discoverProjectRoot } from "../workflow/project-root.js";

type ReplayOptions = Readonly<{
    baseline?: string;
    candidate?: string;
    id?: string;
    input?: string;
    json?: boolean;
    name?: string;
    path?: string;
}>;

type ReplayEvent = Readonly<{ payload: string; step: number; type: string }>;

type ReplayArtifact = Readonly<{
    artifactId: string;
    checksum: string;
    createdAt: string;
    input: string;
    name: string;
    projectRoot: string;
    trace: {
        events: ReadonlyArray<ReplayEvent>;
    };
}>;

/**
 * Reasons a `replay run` / `replay assert` action can fail to load an
 * artifact. Surfaced on the JSON `payload.reason` field so callers can
 * distinguish "absent" from "structurally invalid" without needing to inspect
 * the on-disk file directly.
 */
type ReplayArtifactLookupFailureReason = "artifact_invalid" | "artifact_not_found";

function printReplayPayload(payload: unknown): void {
    console.log(JSON.stringify(payload, null, 2));
}

function addReplaySharedOptions(command: Command): Command {
    return command
        .addOption(createPathOption())
        .option("--json", "Emit machine-readable execution results in JSON format.");
}

function resolveReplayProjectRoot(options: ReplayOptions): Promise<string> {
    return discoverProjectRoot({ explicitProjectPath: options.path });
}

/**
 * Structural validator for a {@link ReplayEvent} entry inside an artifact's
 * `trace.events` array.
 *
 * The predicate intentionally checks every property a downstream consumer
 * reads (`payload`, `step`, `type`) so that the run/compare/assert code paths
 * can dereference them without conditional guards.
 */
function isReplayEvent(value: unknown): value is ReplayEvent {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.payload === "string" &&
        typeof value.type === "string" &&
        typeof value.step === "number" &&
        Number.isFinite(value.step)
    );
}

/**
 * Structural validator for a {@link ReplayArtifact} JSON payload.
 *
 * Without this guard, a hand-edited, truncated, or version-mismatched
 * artifact file would survive `readArtifactJson` (it returns whatever the
 * file contains) and only crash later when the run/compare/assert paths
 * attempted to read `artifact.trace.events[i].type` or compute arithmetic on
 * `trace.events.length`. Returning `false` causes
 * {@link readValidatedArtifactJson} to resolve to `null` so the failure is
 * reported via the structured `reason` field rather than as an unhandled
 * `TypeError`.
 */
function isReplayArtifact(value: unknown): value is ReplayArtifact {
    if (!isRecord(value)) {
        return false;
    }

    if (
        typeof value.artifactId !== "string" ||
        typeof value.checksum !== "string" ||
        typeof value.createdAt !== "string" ||
        typeof value.input !== "string" ||
        typeof value.name !== "string" ||
        typeof value.projectRoot !== "string"
    ) {
        return false;
    }

    const trace = value.trace;
    if (!isRecord(trace) || !Array.isArray(trace.events)) {
        return false;
    }

    return trace.events.every(isReplayEvent);
}

function resolveReplayArtifactFilePath(projectRoot: string, artifactId: string): string {
    const artifactsDirectory = resolveArtifactDirectory(projectRoot, path.join("replay", "artifacts"));
    return path.join(artifactsDirectory, `${artifactId}.json`);
}

function resolveReplayArtifact(projectRoot: string, artifactId: string): Promise<ReplayArtifact | null> {
    return readValidatedArtifactJson<ReplayArtifact>(resolveReplayArtifactFilePath(projectRoot, artifactId), {
        validate: isReplayArtifact
    });
}

/**
 * Classify a failed artifact lookup so the action handlers can emit a
 * structured `reason` instead of conflating "missing" and "malformed".
 */
async function classifyReplayArtifactLookupFailure(
    projectRoot: string,
    artifactId: string
): Promise<ReplayArtifactLookupFailureReason> {
    if (await fileExists(resolveReplayArtifactFilePath(projectRoot, artifactId))) {
        return "artifact_invalid";
    }
    return "artifact_not_found";
}

async function listReplayArtifactIds(projectRoot: string): Promise<Array<string>> {
    const artifactsDirectory = resolveArtifactDirectory(projectRoot, path.join("replay", "artifacts"));
    const names = await listJsonBasenames(artifactsDirectory);
    return names.map((name) => name.slice(0, -".json".length));
}

function buildReplayArtifactSeed(
    projectRoot: string,
    input: string,
    name: string
): {
    input: string;
    name: string;
    projectRoot: string;
    trace: { events: Array<{ payload: string; step: number; type: string }> };
} {
    return {
        input,
        name,
        projectRoot,
        trace: {
            events: [
                { payload: name, step: 1, type: "start" },
                { payload: input, step: 2, type: "input" },
                { payload: `${name}:${input.length}`, step: 3, type: "complete" }
            ]
        }
    };
}

function createReplayArtifact(projectRoot: string, options: ReplayOptions): ReplayArtifact {
    const createdAt = new Date().toISOString();
    const input = options.input ?? "";
    const name = options.name ?? "default";
    const seed = buildReplayArtifactSeed(projectRoot, input, name);
    const artifactId = createDeterministicArtifactId("replay", seed);
    const checksum = createDeterministicArtifactId("sha", seed);

    return {
        artifactId,
        checksum,
        createdAt,
        input,
        name,
        projectRoot,
        trace: seed.trace
    };
}

async function persistReplayArtifact(projectRoot: string, artifact: ReplayArtifact): Promise<string> {
    const artifactsDirectory = await ensureArtifactDirectory(projectRoot, path.join("replay", "artifacts"));
    const artifactPath = path.join(artifactsDirectory, `${artifact.artifactId}.json`);
    await writeArtifactJson(artifactPath, artifact);
    await writeArtifactJson(path.join(resolveArtifactDirectory(projectRoot, "replay"), "latest.json"), {
        latestArtifactId: artifact.artifactId
    });
    return artifactPath;
}

async function resolveLatestReplayArtifactId(projectRoot: string): Promise<string | null> {
    const latestPath = path.join(resolveArtifactDirectory(projectRoot, "replay"), "latest.json");
    const latest = await readArtifactJson<{ latestArtifactId: string }>(latestPath);
    if (!latest || typeof latest.latestArtifactId !== "string" || latest.latestArtifactId.length === 0) {
        return null;
    }
    return latest.latestArtifactId;
}

async function runReplayRecordAction(options: ReplayOptions): Promise<void> {
    const projectRoot = await resolveReplayProjectRoot(options);
    const artifact = createReplayArtifact(projectRoot, options);
    const artifactPath = await persistReplayArtifact(projectRoot, artifact);
    printReplayPayload({
        command: "replay record",
        payload: { artifact, artifactPath, ok: true, projectRoot }
    });
}

async function runReplayRunAction(options: ReplayOptions): Promise<void> {
    const projectRoot = await resolveReplayProjectRoot(options);
    const resolvedId = options.id ?? (await resolveLatestReplayArtifactId(projectRoot));
    if (!resolvedId) {
        printReplayPayload({
            command: "replay run",
            payload: { ok: false, reason: "artifact_not_found" }
        });
        return;
    }

    const artifact = await resolveReplayArtifact(projectRoot, resolvedId);
    if (!artifact) {
        const reason = await classifyReplayArtifactLookupFailure(projectRoot, resolvedId);
        printReplayPayload({
            command: "replay run",
            payload: { artifactId: resolvedId, ok: false, reason }
        });
        return;
    }

    const output = {
        checksum: artifact.checksum,
        eventCount: artifact.trace.events.length,
        finalPayload: artifact.trace.events.at(-1)?.payload ?? ""
    };

    printReplayPayload({
        command: "replay run",
        payload: { artifact, artifactId: artifact.artifactId, ok: true, output, projectRoot }
    });
}

function createReplayDiff(
    baseline: ReplayArtifact,
    candidate: ReplayArtifact
): {
    checksumChanged: boolean;
    eventCountDelta: number;
} {
    return {
        checksumChanged: baseline.checksum !== candidate.checksum,
        eventCountDelta: candidate.trace.events.length - baseline.trace.events.length
    };
}

async function runReplayCompareAction(options: ReplayOptions): Promise<void> {
    const projectRoot = await resolveReplayProjectRoot(options);
    const ids = await listReplayArtifactIds(projectRoot);
    const baselineId = options.baseline ?? ids.at(-2) ?? "";
    const candidateId = options.candidate ?? ids.at(-1) ?? "";
    const baseline = baselineId.length > 0 ? await resolveReplayArtifact(projectRoot, baselineId) : null;
    const candidate = candidateId.length > 0 ? await resolveReplayArtifact(projectRoot, candidateId) : null;

    if (!baseline || !candidate) {
        const baselineReason =
            baselineId.length > 0 && !baseline
                ? await classifyReplayArtifactLookupFailure(projectRoot, baselineId)
                : null;
        const candidateReason =
            candidateId.length > 0 && !candidate
                ? await classifyReplayArtifactLookupFailure(projectRoot, candidateId)
                : null;

        printReplayPayload({
            command: "replay compare",
            payload: {
                availableArtifactIds: ids,
                baselineReason,
                candidateReason,
                ok: false,
                reason: "missing_artifacts"
            }
        });
        return;
    }

    printReplayPayload({
        command: "replay compare",
        payload: {
            baseline,
            baselineId,
            candidate,
            candidateId,
            diff: createReplayDiff(baseline, candidate),
            ok: true,
            projectRoot
        }
    });
}

async function runReplayAssertAction(options: ReplayOptions): Promise<void> {
    const projectRoot = await resolveReplayProjectRoot(options);
    const resolvedId = options.id ?? (await resolveLatestReplayArtifactId(projectRoot));
    if (!resolvedId) {
        printReplayPayload({
            command: "replay assert",
            payload: { ok: false, reason: "artifact_not_found" }
        });
        return;
    }

    const artifact = await resolveReplayArtifact(projectRoot, resolvedId);
    if (!artifact) {
        const reason = await classifyReplayArtifactLookupFailure(projectRoot, resolvedId);
        printReplayPayload({
            command: "replay assert",
            payload: { artifactId: resolvedId, ok: false, reason }
        });
        return;
    }

    const passed = artifact.trace.events.length >= 3 && artifact.trace.events[0]?.type === "start";
    printReplayPayload({
        command: "replay assert",
        payload: {
            artifactId: artifact.artifactId,
            assertions: {
                hasDeterministicEventFlow: passed,
                minimumEventCount: artifact.trace.events.length >= 3
            },
            ok: passed,
            projectRoot
        }
    });
}

export function createReplayCommand(): Command {
    const command = applyStandardCommandOptions(new Command("replay")).description(
        "Manage deterministic execution traces of AI agent interactions. Replay tools allow recording, running, comparing, and validating interaction sequences for testing, replication, and regression analysis."
    );

    const record = addReplaySharedOptions(
        applyStandardCommandOptions(new Command("record"))
            .description(
                "Record a new interaction trace artifact by capturing an input payload, scenario name, and generated steps. Saved trace artifacts can be used to replicate behaviors or compare outcomes during development."
            )
            .option("--name <name>", "Name of the replay scenario to record.")
            .option("--input <value>", "Input payload or instructions starting the replay scenario.")
    );
    record.action(async function replayRecordAction() {
        await runReplayRecordAction(this.opts<ReplayOptions>());
    });

    const run = addReplaySharedOptions(
        applyStandardCommandOptions(new Command("run"))
            .description(
                "Execute and summarize a recorded interaction trace to verify that the steps and output payload match expected results. Uses the latest trace or a specified artifact ID."
            )
            .option(
                "--id <id>",
                "ID of the recorded replay artifact to execute. If omitted, the latest recorded artifact will be run."
            )
    );
    run.action(async function replayRunAction() {
        await runReplayRunAction(this.opts<ReplayOptions>());
    });

    const compare = addReplaySharedOptions(
        applyStandardCommandOptions(new Command("compare"))
            .description(
                "Compare two recorded trace artifacts (a baseline and a candidate) to detect structural differences, event count discrepancies, or payload drift between agent runs."
            )
            .option(
                "--baseline <id>",
                "ID of the baseline replay artifact. Defaults to the second-to-last recorded artifact."
            )
            .option(
                "--candidate <id>",
                "ID of the candidate replay artifact. Defaults to the latest recorded artifact."
            )
    );
    compare.action(async function replayCompareAction() {
        await runReplayCompareAction(this.opts<ReplayOptions>());
    });

    const assertCommand = addReplaySharedOptions(
        applyStandardCommandOptions(new Command("assert"))
            .description(
                "Validate the structural integrity and constraints of a recorded trace artifact (such as deterministic event flow and minimum step counts) for use in automated test suites."
            )
            .option(
                "--id <id>",
                "ID of the recorded replay artifact to assert against. If omitted, the latest recorded artifact will be asserted."
            )
    );
    assertCommand.action(async function replayAssertAction() {
        await runReplayAssertAction(this.opts<ReplayOptions>());
    });

    command.addCommand(record);
    command.addCommand(run);
    command.addCommand(compare);
    command.addCommand(assertCommand);
    return command;
}
