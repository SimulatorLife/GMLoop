import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;
type BaselineFinding = {
    filePath: string;
    repositoryPath: string;
    portableKey: string;
    severity: number;
    used: boolean;
};
type TargetFinding = {
    filePath: string;
    message: JsonRecord;
    exactKey: string;
    portableKey: string;
    severity: number;
    matched: boolean;
};

const LINT_FILE = "eslint.json";

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(value: string): string {
    return value.replaceAll("\\", "/");
}

function normalizeRepositoryPath(value: string): string {
    const normalized = normalizePath(value);
    const marker = "/GMLoop/";
    const markerIndex = normalized.lastIndexOf(marker);
    return markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : normalized.replace(/^\.\//u, "");
}

function normalizeLintMessage(ruleId: string, message: string): string {
    if (ruleId === "max-lines" || ruleId === "max-lines-per-function") {
        return message.replace(/too many lines \(\d+\)(?=\. Maximum allowed is \d+\.)/u, "too many lines (<current>)");
    }
    if (ruleId === "sonarjs/cognitive-complexity") {
        return message.replace(/Cognitive Complexity from \d+ to the (?=\d+ allowed\.)/u, "Cognitive Complexity from <current> to the ");
    }
    return message;
}

function readFinding(message: JsonRecord): Readonly<{ portableKey: string; severity: number }> | null {
    const severity = Number(message.severity);
    if (![1, 2].includes(severity) || typeof message.message !== "string") return null;
    const ruleId = typeof message.ruleId === "string" ? message.ruleId : "";
    return Object.freeze({
        portableKey: [ruleId, normalizeLintMessage(ruleId, message.message)].join("\0"),
        severity
    });
}

function collectBaseline(value: unknown): Array<BaselineFinding> {
    if (!Array.isArray(value)) throw new Error("Lint evidence is not an array.");
    const findings: Array<BaselineFinding> = [];
    for (const fileValue of value) {
        if (!isRecord(fileValue) || typeof fileValue.filePath !== "string" || !Array.isArray(fileValue.messages)) {
            throw new Error("Malformed lint evidence.");
        }
        for (const message of fileValue.messages) {
            if (!isRecord(message)) continue;
            const finding = readFinding(message);
            if (!finding) continue;
            findings.push({
                filePath: fileValue.filePath,
                repositoryPath: normalizeRepositoryPath(fileValue.filePath),
                portableKey: finding.portableKey,
                severity: finding.severity,
                used: false
            });
        }
    }
    return findings;
}

function collectTarget(value: unknown): Array<TargetFinding> {
    if (!Array.isArray(value)) throw new Error("Lint evidence is not an array.");
    const findings: Array<TargetFinding> = [];
    for (const fileValue of value) {
        if (!isRecord(fileValue) || typeof fileValue.filePath !== "string" || !Array.isArray(fileValue.messages)) {
            throw new Error("Malformed lint evidence.");
        }
        const repositoryPath = normalizeRepositoryPath(fileValue.filePath);
        for (const message of fileValue.messages) {
            if (!isRecord(message)) continue;
            const finding = readFinding(message);
            if (!finding) continue;
            findings.push({
                filePath: fileValue.filePath,
                message,
                exactKey: [repositoryPath, finding.portableKey].join("\0"),
                portableKey: finding.portableKey,
                severity: finding.severity,
                matched: false
            });
        }
    }
    return findings;
}

function takeBaseline(
    pool: ReadonlyMap<string, ReadonlyArray<BaselineFinding>>,
    key: string,
    severity: number
): BaselineFinding | undefined {
    const candidates = pool.get(key) ?? [];
    return candidates.find((candidate) => !candidate.used && candidate.severity >= severity);
}

function rewriteRelocatedLint(baseValue: unknown, targetValue: unknown): Array<JsonRecord> {
    const baseline = collectBaseline(baseValue);
    const target = collectTarget(targetValue);
    const exactPool = new Map<string, Array<BaselineFinding>>();
    const portablePool = new Map<string, Array<BaselineFinding>>();
    for (const finding of baseline) {
        const exactKey = [finding.repositoryPath, finding.portableKey].join("\0");
        exactPool.set(exactKey, [...(exactPool.get(exactKey) ?? []), finding]);
        portablePool.set(finding.portableKey, [...(portablePool.get(finding.portableKey) ?? []), finding]);
    }
    for (const finding of target) {
        const matched = takeBaseline(exactPool, finding.exactKey, finding.severity);
        if (!matched) continue;
        matched.used = true;
        finding.matched = true;
    }
    const output: Array<JsonRecord> = [];
    for (const finding of target) {
        let filePath = finding.filePath;
        if (!finding.matched) {
            const relocated = takeBaseline(portablePool, finding.portableKey, finding.severity);
            if (relocated) {
                relocated.used = true;
                filePath = relocated.filePath;
            }
        }
        output.push({ filePath, messages: [finding.message] });
    }
    return output;
}

function readJson(file: string): unknown {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

function findOption(args: ReadonlyArray<string>, name: string): string {
    const index = args.indexOf(`--${name}`);
    const value = index >= 0 ? args[index + 1] : undefined;
    if (!value) throw new Error(`--${name} is required.`);
    return value;
}

function prepareEvaluation(args: ReadonlyArray<string>): void {
    const baseDirectory = findOption(args, "base");
    const mergeDirectory = findOption(args, "merge");
    const baseFile = path.join(baseDirectory, LINT_FILE);
    const mergeFile = path.join(mergeDirectory, LINT_FILE);
    const rewritten = rewriteRelocatedLint(readJson(baseFile), readJson(mergeFile));
    fs.writeFileSync(mergeFile, `${JSON.stringify(rewritten)}\n`, "utf8");
}

function selfTest(): void {
    const warning = { severity: 1, ruleId: "x", message: "existing" };
    const base = [{ filePath: "/repo/GMLoop/a.ts", messages: [warning] }];
    const moved = rewriteRelocatedLint(base, [{ filePath: "/repo/GMLoop/b.ts", messages: [warning] }]);
    assert.equal(moved[0]?.filePath, "/repo/GMLoop/a.ts");
    const duplicate = rewriteRelocatedLint(base, [
        { filePath: "/repo/GMLoop/a.ts", messages: [warning] },
        { filePath: "/repo/GMLoop/b.ts", messages: [warning] }
    ]);
    assert.equal(duplicate[1]?.filePath, "/repo/GMLoop/b.ts");
    const upgraded = rewriteRelocatedLint(base, [{
        filePath: "/repo/GMLoop/b.ts",
        messages: [{ ...warning, severity: 2 }]
    }]);
    assert.equal(upgraded[0]?.filePath, "/repo/GMLoop/b.ts");
}

function main(): number {
    const args = process.argv.slice(2);
    if (args[0] === "self-test") selfTest();
    if (args[0] === "evaluate") prepareEvaluation(args.slice(1));
    const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), "ci-automerge-gate-impl.ts");
    const result = spawnSync(process.execPath, [helper, ...args], {
        env: process.env,
        stdio: "inherit"
    });
    if (result.error) throw result.error;
    return result.status ?? 2;
}

try {
    process.exitCode = main();
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 2;
}
