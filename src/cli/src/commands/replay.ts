import path from "node:path";

import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createPathOption } from "../cli-core/shared-command-options.js";
import {
    createDeterministicArtifactId,
    ensureArtifactDirectory,
    listJsonBasenames,
    readArtifactJson,
    resolveArtifactDirectory,
    writeArtifactJson
} from "../modules/runtime/index.js";
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

type ReplayArtifact = Readonly<{
    artifactId: string;
    checksum: string;
    createdAt: string;
    input: string;
    name: string;
    projectRoot: string;
    trace: {
        events: ReadonlyArray<{ payload: string; step: number; type: string }>;
    };
}>;

function printReplayPayload(payload: unknown, asJson: boolean): void {
    if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }
    console.log(JSON.stringify(payload, null, 2));
}

function addReplaySharedOptions(command: Command): Command {
    return command.addOption(createPathOption()).option("--json", "Emit JSON output.");
}

async function resolveReplayProjectRoot(options: ReplayOptions): Promise<string> {
    return await discoverProjectRoot({ explicitProjectPath: options.path });
}

async function resolveReplayArtifact(projectRoot: string, artifactId: string): Promise<ReplayArtifact | null> {
    const artifactsDirectory = resolveArtifactDirectory(projectRoot, path.join("replay", "artifacts"));
    return await readArtifactJson<ReplayArtifact>(path.join(artifactsDirectory, `${artifactId}.json`));
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
    printReplayPayload(
        { command: "replay record", payload: { artifact, artifactPath, ok: true, projectRoot } },
        options.json === true
    );
}

async function runReplayRunAction(options: ReplayOptions): Promise<void> {
    const projectRoot = await resolveReplayProjectRoot(options);
    const resolvedId = options.id ?? (await resolveLatestReplayArtifactId(projectRoot));
    if (!resolvedId) {
        printReplayPayload(
            { command: "replay run", payload: { ok: false, reason: "artifact_not_found" } },
            options.json === true
        );
        return;
    }

    const artifact = await resolveReplayArtifact(projectRoot, resolvedId);
    if (!artifact) {
        printReplayPayload(
            { command: "replay run", payload: { artifactId: resolvedId, ok: false, reason: "artifact_not_found" } },
            options.json === true
        );
        return;
    }

    const output = {
        checksum: artifact.checksum,
        eventCount: artifact.trace.events.length,
        finalPayload: artifact.trace.events.at(-1)?.payload ?? ""
    };

    printReplayPayload(
        {
            command: "replay run",
            payload: { artifact, artifactId: artifact.artifactId, ok: true, output, projectRoot }
        },
        options.json === true
    );
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
        printReplayPayload(
            {
                command: "replay compare",
                payload: { availableArtifactIds: ids, ok: false, reason: "missing_artifacts" }
            },
            options.json === true
        );
        return;
    }

    printReplayPayload(
        {
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
        },
        options.json === true
    );
}

async function runReplayAssertAction(options: ReplayOptions): Promise<void> {
    const projectRoot = await resolveReplayProjectRoot(options);
    const resolvedId = options.id ?? (await resolveLatestReplayArtifactId(projectRoot));
    if (!resolvedId) {
        printReplayPayload(
            { command: "replay assert", payload: { ok: false, reason: "artifact_not_found" } },
            options.json === true
        );
        return;
    }

    const artifact = await resolveReplayArtifact(projectRoot, resolvedId);
    if (!artifact) {
        printReplayPayload(
            { command: "replay assert", payload: { artifactId: resolvedId, ok: false, reason: "artifact_not_found" } },
            options.json === true
        );
        return;
    }

    const passed = artifact.trace.events.length >= 3 && artifact.trace.events[0]?.type === "start";
    printReplayPayload(
        {
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
        },
        options.json === true
    );
}

export function createReplayCommand(): Command {
    const command = applyStandardCommandOptions(new Command("replay")).description(
        "Record and replay AI interactions."
    );

    const record = addReplaySharedOptions(
        applyStandardCommandOptions(new Command("record"))
            .description("Record a replay trace.")
            .option("--name <name>", "Replay scenario name.")
            .option("--input <value>", "Replay input payload.")
    );
    record.action(async function replayRecordAction() {
        await runReplayRecordAction(this.opts<ReplayOptions>());
    });

    const run = addReplaySharedOptions(
        applyStandardCommandOptions(new Command("run"))
            .description("Run a replay trace.")
            .option("--id <id>", "Replay artifact id.")
    );
    run.action(async function replayRunAction() {
        await runReplayRunAction(this.opts<ReplayOptions>());
    });

    const compare = addReplaySharedOptions(
        applyStandardCommandOptions(new Command("compare"))
            .description("Compare replay outputs.")
            .option("--baseline <id>", "Baseline replay artifact id.")
            .option("--candidate <id>", "Candidate replay artifact id.")
    );
    compare.action(async function replayCompareAction() {
        await runReplayCompareAction(this.opts<ReplayOptions>());
    });

    const assertCommand = addReplaySharedOptions(
        applyStandardCommandOptions(new Command("assert"))
            .description("Assert replay expectations.")
            .option("--id <id>", "Replay artifact id.")
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
