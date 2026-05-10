import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
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

type ProfileOptions = Readonly<{
    baseline?: string;
    candidate?: string;
    json?: boolean;
    path?: string;
}>;

type ProfileSnapshot = Readonly<{
    capturedAt: string;
    id: string;
    metrics: {
        gmlFileCount: number;
        totalGmlBytes: number;
    };
    projectRoot: string;
}>;

type ProfileSession = Readonly<{
    active: boolean;
    startedAt: string | null;
}>;

function printProfilePayload(payload: unknown, asJson: boolean): void {
    if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }
    console.log(JSON.stringify(payload, null, 2));
}

function addProfileSharedOptions(command: Command): Command {
    return command.addOption(createPathOption()).option("--json", "Emit JSON output.");
}

async function collectProjectProfileMetrics(
    projectRoot: string
): Promise<{ gmlFileCount: number; totalGmlBytes: number }> {
    const gmlFilePaths = await collectGmlFilePaths(projectRoot);
    const gmlFileCount = gmlFilePaths.length;

    const stats = await Promise.all(gmlFilePaths.map(async (filePath) => await stat(filePath).catch(() => null)));
    const totalGmlBytes = stats.reduce((accumulator, fileStats) => accumulator + (fileStats?.size ?? 0), 0);

    return { gmlFileCount, totalGmlBytes };
}

async function collectGmlFilePaths(directory: string): Promise<Array<string>> {
    const entries = await Core.safeReaddirDirent({ readDir: readdir }, directory);
    const nestedPaths = await Promise.all(
        entries.map(async (entry) => {
            if (
                entry.name === "node_modules" ||
                entry.name === ".git" ||
                entry.name === ".gmloop" ||
                entry.name === "dist"
            ) {
                return [] as Array<string>;
            }
            const resolved = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                return await collectGmlFilePaths(resolved);
            }
            if (entry.isFile() && entry.name.toLowerCase().endsWith(".gml")) {
                return [resolved];
            }
            return [] as Array<string>;
        })
    );
    return nestedPaths.flat();
}

async function resolveProfileProjectRoot(options: ProfileOptions): Promise<string> {
    return await discoverProjectRoot({ explicitProjectPath: options.path });
}

async function readProfileSession(projectRoot: string): Promise<ProfileSession> {
    const profileDirectory = await ensureArtifactDirectory(projectRoot, "profile");
    const sessionPath = path.join(profileDirectory, "session.json");
    const existing = await readArtifactJson<ProfileSession>(sessionPath);
    if (existing) {
        return existing;
    }
    return {
        active: false,
        startedAt: null
    };
}

async function writeProfileSession(projectRoot: string, session: ProfileSession): Promise<string> {
    const profileDirectory = await ensureArtifactDirectory(projectRoot, "profile");
    const sessionPath = path.join(profileDirectory, "session.json");
    await writeArtifactJson(sessionPath, session);
    return sessionPath;
}

async function createProfileSnapshot(projectRoot: string): Promise<ProfileSnapshot> {
    const capturedAt = new Date().toISOString();
    const metrics = await collectProjectProfileMetrics(projectRoot);
    const snapshotSeed = { capturedAt, metrics, projectRoot };
    const id = createDeterministicArtifactId("profile", snapshotSeed);
    return {
        capturedAt,
        id,
        metrics,
        projectRoot
    };
}

async function persistProfileSnapshot(projectRoot: string, snapshot: ProfileSnapshot): Promise<string> {
    const snapshotsDirectory = await ensureArtifactDirectory(projectRoot, path.join("profile", "snapshots"));
    const snapshotPath = path.join(snapshotsDirectory, `${snapshot.id}.json`);
    await writeArtifactJson(snapshotPath, snapshot);
    return snapshotPath;
}

async function resolveSnapshot(projectRoot: string, id: string): Promise<ProfileSnapshot | null> {
    const snapshotsDirectory = resolveArtifactDirectory(projectRoot, path.join("profile", "snapshots"));
    return await readArtifactJson<ProfileSnapshot>(path.join(snapshotsDirectory, `${id}.json`));
}

async function listSnapshotIds(projectRoot: string): Promise<Array<string>> {
    const snapshotsDirectory = resolveArtifactDirectory(projectRoot, path.join("profile", "snapshots"));
    const names = await listJsonBasenames(snapshotsDirectory);
    return names.map((name) => name.slice(0, -".json".length));
}

async function runProfileStartAction(options: ProfileOptions): Promise<void> {
    const projectRoot = await resolveProfileProjectRoot(options);
    const session: ProfileSession = {
        active: true,
        startedAt: new Date().toISOString()
    };
    const sessionPath = await writeProfileSession(projectRoot, session);
    printProfilePayload(
        { command: "profile start", payload: { ok: true, projectRoot, session, sessionPath } },
        options.json === true
    );
}

async function runProfileStopAction(options: ProfileOptions): Promise<void> {
    const projectRoot = await resolveProfileProjectRoot(options);
    const previous = await readProfileSession(projectRoot);
    const session: ProfileSession = { active: false, startedAt: null };
    await writeProfileSession(projectRoot, session);

    const snapshot = await createProfileSnapshot(projectRoot);
    const snapshotPath = await persistProfileSnapshot(projectRoot, snapshot);

    printProfilePayload(
        {
            command: "profile stop",
            payload: {
                ok: true,
                previousSession: previous,
                projectRoot,
                session,
                snapshot,
                snapshotPath
            }
        },
        options.json === true
    );
}

async function runProfileSnapshotAction(options: ProfileOptions): Promise<void> {
    const projectRoot = await resolveProfileProjectRoot(options);
    const snapshot = await createProfileSnapshot(projectRoot);
    const snapshotPath = await persistProfileSnapshot(projectRoot, snapshot);
    printProfilePayload(
        { command: "profile snapshot", payload: { ok: true, projectRoot, snapshot, snapshotPath } },
        options.json === true
    );
}

function createSnapshotDelta(
    baseline: ProfileSnapshot,
    candidate: ProfileSnapshot
): { gmlFileCount: number; totalGmlBytes: number } {
    return {
        gmlFileCount: candidate.metrics.gmlFileCount - baseline.metrics.gmlFileCount,
        totalGmlBytes: candidate.metrics.totalGmlBytes - baseline.metrics.totalGmlBytes
    };
}

async function runProfileCompareAction(options: ProfileOptions): Promise<void> {
    const projectRoot = await resolveProfileProjectRoot(options);
    const ids = await listSnapshotIds(projectRoot);
    const baselineId = options.baseline ?? ids.at(-2) ?? "";
    const candidateId = options.candidate ?? ids.at(-1) ?? "";
    const baseline = baselineId.length > 0 ? await resolveSnapshot(projectRoot, baselineId) : null;
    const candidate = candidateId.length > 0 ? await resolveSnapshot(projectRoot, candidateId) : null;

    if (!baseline || !candidate) {
        printProfilePayload(
            {
                command: "profile compare",
                payload: {
                    availableSnapshotIds: ids,
                    ok: false,
                    reason: "missing_snapshots"
                }
            },
            options.json === true
        );
        return;
    }

    printProfilePayload(
        {
            command: "profile compare",
            payload: {
                baseline,
                baselineId,
                candidate,
                candidateId,
                delta: createSnapshotDelta(baseline, candidate),
                ok: true,
                projectRoot
            }
        },
        options.json === true
    );
}

async function runProfileReportAction(options: ProfileOptions): Promise<void> {
    const projectRoot = await resolveProfileProjectRoot(options);
    const session = await readProfileSession(projectRoot);
    const ids = await listSnapshotIds(projectRoot);
    const latestId = ids.at(-1) ?? null;
    const latestSnapshot = latestId ? await resolveSnapshot(projectRoot, latestId) : null;

    printProfilePayload(
        {
            command: "profile report",
            payload: {
                latestSnapshot,
                latestSnapshotId: latestId,
                ok: true,
                projectRoot,
                session,
                snapshotCount: ids.length,
                snapshotIds: ids
            }
        },
        options.json === true
    );
}

export function createProfileCommand(): Command {
    const command = applyStandardCommandOptions(new Command("profile")).description(
        "Collect and inspect runtime profiling traces."
    );

    const start = addProfileSharedOptions(
        applyStandardCommandOptions(new Command("start")).description("Start profiling capture.")
    );
    start.action(async function profileStartAction() {
        await runProfileStartAction(this.opts<ProfileOptions>());
    });

    const stop = addProfileSharedOptions(
        applyStandardCommandOptions(new Command("stop")).description("Stop profiling capture.")
    );
    stop.action(async function profileStopAction() {
        await runProfileStopAction(this.opts<ProfileOptions>());
    });

    const snapshot = addProfileSharedOptions(
        applyStandardCommandOptions(new Command("snapshot")).description("Capture one profile snapshot.")
    );
    snapshot.action(async function profileSnapshotAction() {
        await runProfileSnapshotAction(this.opts<ProfileOptions>());
    });

    const compare = addProfileSharedOptions(
        applyStandardCommandOptions(new Command("compare"))
            .description("Compare profile sessions or snapshots.")
            .option("--baseline <id>", "Baseline snapshot id.")
            .option("--candidate <id>", "Candidate snapshot id.")
    );
    compare.action(async function profileCompareAction() {
        await runProfileCompareAction(this.opts<ProfileOptions>());
    });

    const report = addProfileSharedOptions(
        applyStandardCommandOptions(new Command("report")).description("Render profile report output.")
    );
    report.action(async function profileReportAction() {
        await runProfileReportAction(this.opts<ProfileOptions>());
    });

    command.addCommand(start);
    command.addCommand(stop);
    command.addCommand(snapshot);
    command.addCommand(compare);
    command.addCommand(report);
    return command;
}
