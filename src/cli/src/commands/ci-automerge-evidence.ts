import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const BUILD_FILE = "build-evidence.json";
const REPORT_FILE = "auto-merge-report.json";
const MANIFEST_FILE = "test-manifest.json";
const LINT_FILE = "eslint.json";
const LINT_META_FILE = "lint-meta.json";
const CASES_FILE = "test-cases.json";
const TIMINGS_FILE = "test-durations.json";
const INFRA_JUNIT_MARKER = "AUTOMERGE_INFRASTRUCTURE_FAILURE";
const SCHEMA_VERSION = 4;
const MANIFEST_SCHEMA_VERSION = 2;
const EVIDENCE_FILES = [
    "src/cli/src/commands/ci-automerge-evidence.ts",
    "src/cli/src/commands/ci-automerge-gate.ts",
    "src/cli/src/commands/ci-automerge-state.ts",
    ".github/ci/automerge-policy.json",
    ".github/actions/run-automerge-validation/action.yml",
    ".github/workflows/automerge-prs.yml",
    ".github/workflows/cache-automerge-base-report.yml",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".nvmrc",
    ".npmrc",
    ".pnpmfile.cjs",
    "eslint.config.js"
] as const;

type StringMap = Record<string, string>;
type ParsedArgs = Readonly<{ positional: ReadonlyArray<string>; options: StringMap }>;
type TestWeight = Readonly<{ file: string; weightMs: number }>;
type TestShard = Readonly<{ name: string; files: ReadonlyArray<string>; estimatedDurationMs: number }>;
type TestManifest = Readonly<{
    schemaVersion: number;
    tests: ReadonlyArray<string>;
    shardCount: number;
    manifestDigest: string;
    planDigest: string;
    shards: ReadonlyArray<TestShard>;
}>;
type BuildEvidence = Readonly<{
    schemaVersion: number;
    targetSha: string;
    command: string;
    completed: boolean;
    succeeded: boolean;
    status: number;
    timedOut: boolean;
    durationMs: number;
    testsSkippedReason: "build-failed" | "infrastructure" | null;
}>;
type ShardEvidence = Readonly<{
    schemaVersion: number;
    shard: string;
    completed: boolean;
    status: number;
    timedOut: boolean;
    durationMs: number;
    testFiles: ReadonlyArray<string>;
    manifestDigest: string;
    planDigest: string;
    reportFile: string;
}>;
type TestCaseEvidence = Readonly<{
    file: string;
    name: string;
    status: "passed" | "failed" | "skipped";
    durationMs: number;
    shard: string;
}>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArguments(argv: ReadonlyArray<string>): ParsedArgs {
    const positional: Array<string> = [];
    const options: StringMap = {};
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index] ?? "";
        if (!value.startsWith("--")) {
            positional.push(value);
            continue;
        }
        const key = value.slice(2);
        const next = argv[index + 1];
        if (next === undefined || next.startsWith("--")) {
            options[key] = "true";
            continue;
        }
        options[key] = next;
        index += 1;
    }
    return Object.freeze({ positional, options });
}

function requireOption(args: ParsedArgs, name: string): string {
    const value = args.options[name]?.trim();
    if (!value) throw new Error(`--${name} is required.`);
    return value;
}

function parseInteger(value: string | undefined, fallback = 0): number {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isInteger(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | undefined): boolean {
    return String(value ?? "").toLowerCase() === "true";
}

function normalizePath(value: string): string {
    return value.split(path.sep).join("/");
}

function normalizeRepositoryPath(value: string): string {
    const normalized = normalizePath(value);
    const root = normalizePath(process.cwd()).replace(/\/$/u, "");
    if (normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1);
    const marker = "/GMLoop/";
    const markerIndex = normalized.lastIndexOf(marker);
    return markerIndex === -1 ? normalized.replace(/^\.\//u, "") : normalized.slice(markerIndex + marker.length);
}

function readJson(file: string): unknown {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

function readOptionalJson(file: string): unknown | null {
    try {
        return readJson(file);
    } catch {
        return null;
    }
}

function writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendOutputs(file: string | undefined, values: Readonly<Record<string, string | number | boolean>>): void {
    if (!file) return;
    const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value)}`);
    fs.appendFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

function collectFiles(rootDirectory: string): Array<string> {
    if (!fs.existsSync(rootDirectory)) return [];
    const output: Array<string> = [];
    const visit = (directory: string): void => {
        const entries = fs.readdirSync(directory, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === "node_modules" || entry.name === ".git") continue;
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(absolutePath);
            else if (entry.isFile()) output.push(normalizePath(path.relative(process.cwd(), absolutePath)));
        }
    };
    visit(rootDirectory);
    return output;
}

function digestText(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function computeFingerprint(): string {
    const candidates = new Set<string>();
    const addFile = (file: string): void => {
        if (fs.existsSync(file) && fs.statSync(file).isFile()) candidates.add(normalizePath(file));
    };
    for (const file of EVIDENCE_FILES) addFile(file);
    for (const file of collectFiles(path.join(process.cwd(), "src"))) {
        if (/(?:^|\/)package\.json$/u.test(file) || /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/u.test(file))
            candidates.add(file);
    }
    for (const entry of fs.readdirSync(process.cwd(), { withFileTypes: true })) {
        if (entry.isFile() && /^tsconfig(?:\.[^/]+)?\.json$/u.test(entry.name)) candidates.add(entry.name);
    }
    const hash = createHash("sha256");
    for (const file of [...candidates].sort((left, right) => left.localeCompare(right))) {
        hash.update(file);
        hash.update("\0");
        hash.update(fs.readFileSync(file));
        hash.update("\0");
    }
    return hash.digest("hex");
}

function isPerformanceTest(relativePath: string): boolean {
    const normalized = normalizePath(relativePath).toLowerCase();
    const basename = path.posix.basename(normalized);
    return (
        normalized.includes("/dist/test/performance/") || basename.includes("performance") || basename.includes("perf")
    );
}

function isCanonicalTestPath(relativePath: string): boolean {
    const normalized = normalizePath(relativePath);
    if (normalized === "test/dist/fixture-suites.js") return true;
    if (!normalized.endsWith(".test.js") || isPerformanceTest(normalized)) return false;
    return (normalized.startsWith("src/") && normalized.includes("/dist/test/")) || normalized.startsWith("test/dist/");
}

function discoverCanonicalTests(): Array<string> {
    const discovered = [
        ...collectFiles(path.join(process.cwd(), "src")),
        ...collectFiles(path.join(process.cwd(), "test", "dist"))
    ];
    return [...new Set(discovered.filter(isCanonicalTestPath))].sort((left, right) => left.localeCompare(right));
}

function median(values: ReadonlyArray<number>): number {
    if (values.length === 0) return 1000;
    const sorted = [...values].sort((left, right) => left - right);
    const midpoint = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
        ? (sorted[midpoint] ?? 1000)
        : ((sorted[midpoint - 1] ?? 1000) + (sorted[midpoint] ?? 1000)) / 2;
}

function createTestWeights(tests: ReadonlyArray<string>, historyFile: string | undefined): Array<TestWeight> {
    const historyValue = historyFile ? readOptionalJson(historyFile) : null;
    const history =
        isRecord(historyValue) && Array.isArray(historyValue.fileDurations) ? historyValue.fileDurations : [];
    const durations = new Map<string, number>();
    for (const entry of history) {
        if (
            !isRecord(entry) ||
            typeof entry.file !== "string" ||
            typeof entry.durationMs !== "number" ||
            entry.durationMs <= 0
        )
            continue;
        durations.set(normalizePath(entry.file), entry.durationMs);
    }
    const known = tests
        .map((testFile) => durations.get(testFile))
        .filter((value): value is number => value !== undefined);
    const fallbackDuration = median(known);
    const sizes = new Map<string, number>();
    for (const testFile of tests) sizes.set(testFile, fs.existsSync(testFile) ? fs.statSync(testFile).size : 1);
    const medianSize = Math.max(1, median([...sizes.values()]));
    return tests.map((testFile) => {
        const duration = durations.get(testFile);
        if (duration !== undefined) return Object.freeze({ file: testFile, weightMs: duration });
        const sizeRatio = Math.min(2, Math.max(0.5, (sizes.get(testFile) ?? medianSize) / medianSize));
        return Object.freeze({ file: testFile, weightMs: Math.max(1, fallbackDuration * sizeRatio) });
    });
}

function createBalancedShards(weights: ReadonlyArray<TestWeight>, shardCount: number): Array<TestShard> {
    if (!Number.isInteger(shardCount) || shardCount < 1 || weights.length < shardCount)
        throw new Error("Invalid non-empty shard plan request.");
    const shards = Array.from({ length: shardCount }, (_, index) => ({
        name: `shard-${index + 1}`,
        files: [] as Array<string>,
        estimatedDurationMs: 0
    }));
    const ordered = [...weights].sort(
        (left, right) => right.weightMs - left.weightMs || left.file.localeCompare(right.file)
    );
    for (const weight of ordered) {
        const target = [...shards].sort(
            (left, right) => left.estimatedDurationMs - right.estimatedDurationMs || left.name.localeCompare(right.name)
        )[0];
        if (!target) throw new Error("Unable to assign a test shard.");
        target.files.push(weight.file);
        target.estimatedDurationMs += weight.weightMs;
    }
    return shards.map((shard) =>
        Object.freeze({
            name: shard.name,
            files: Object.freeze(shard.files.sort((left, right) => left.localeCompare(right))),
            estimatedDurationMs: Math.round(shard.estimatedDurationMs)
        })
    );
}

function calculateManifestDigest(tests: ReadonlyArray<string>): string {
    return digestText([...tests].sort((left, right) => left.localeCompare(right)).join("\0"));
}

function calculatePlanDigest(shards: ReadonlyArray<TestShard>): string {
    return digestText(
        [...shards]
            .sort((left, right) => left.name.localeCompare(right.name))
            .flatMap((shard) => shard.files.map((file) => `${shard.name}:${file}`))
            .join("\0")
    );
}

function parseManifest(value: unknown): TestManifest {
    if (
        !isRecord(value) ||
        value.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
        !Array.isArray(value.tests) ||
        !Array.isArray(value.shards)
    ) {
        throw new Error("Invalid test manifest schema.");
    }
    const tests = value.tests.filter((entry): entry is string => typeof entry === "string").map(normalizePath);
    const shardCount =
        typeof value.shardCount === "number" && Number.isInteger(value.shardCount) ? value.shardCount : 0;
    const shards: Array<TestShard> = [];
    for (const rawShard of value.shards) {
        if (!isRecord(rawShard) || typeof rawShard.name !== "string" || !Array.isArray(rawShard.files))
            throw new Error("Invalid test shard.");
        const files = rawShard.files.filter((entry): entry is string => typeof entry === "string").map(normalizePath);
        if (files.length === 0 || files.length !== rawShard.files.length)
            throw new Error(`Invalid files for shard ${rawShard.name}.`);
        shards.push(
            Object.freeze({
                name: rawShard.name,
                files: Object.freeze(files),
                estimatedDurationMs: typeof rawShard.estimatedDurationMs === "number" ? rawShard.estimatedDurationMs : 0
            })
        );
    }
    const manifest = Object.freeze({
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        tests: Object.freeze(tests),
        shardCount,
        manifestDigest: typeof value.manifestDigest === "string" ? value.manifestDigest : "",
        planDigest: typeof value.planDigest === "string" ? value.planDigest : "",
        shards: Object.freeze(shards)
    });
    if (manifest.shardCount !== manifest.shards.length || manifest.tests.length === 0)
        throw new Error("Manifest shard/test count is invalid.");
    if (
        manifest.manifestDigest !== calculateManifestDigest(manifest.tests) ||
        manifest.planDigest !== calculatePlanDigest(manifest.shards)
    )
        throw new Error("Manifest digest is invalid.");
    const assigned = manifest.shards.flatMap((shard) => shard.files);
    if (
        new Set(assigned).size !== assigned.length ||
        JSON.stringify([...assigned].sort()) !== JSON.stringify([...manifest.tests].sort())
    ) {
        throw new Error("Manifest does not cover every canonical test exactly once.");
    }
    if (!manifest.tests.includes("test/dist/fixture-suites.js"))
        throw new Error("Fixture-suite runner is missing from the canonical corpus.");
    return manifest;
}

function decodeXml(value: string): string {
    return value
        .replaceAll(/&#x([0-9a-f]+);/giu, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replaceAll(/&#([0-9]+);/gu, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&");
}

function parseXmlAttributes(fragment: string): StringMap {
    const attributes: StringMap = {};
    for (const match of fragment.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/gu)) {
        const key = match[1];
        const value = match[2];
        if (key !== undefined && value !== undefined) attributes[key] = decodeXml(value);
    }
    return attributes;
}

function findXmlTagEnd(source: string, start: number): number {
    let quote = "";
    for (let index = start; index < source.length; index += 1) {
        const character = source[index] ?? "";
        if (quote) {
            if (character === quote) quote = "";
        } else if (character === '"' || character === "'") quote = character;
        else if (character === ">") return index;
    }
    return -1;
}

function parseJunitCases(xml: string): Array<Omit<TestCaseEvidence, "shard">> {
    const cases: Array<Omit<TestCaseEvidence, "shard">> = [];
    let cursor = 0;
    while (cursor < xml.length) {
        const start = xml.indexOf("<testcase", cursor);
        if (start === -1) break;
        const attributeStart = start + "<testcase".length;
        if (!/[\s/>]/u.test(xml[attributeStart] ?? " ")) {
            cursor = attributeStart;
            continue;
        }
        const tagEnd = findXmlTagEnd(xml, attributeStart);
        if (tagEnd === -1) break;
        const opening = xml.slice(attributeStart, tagEnd);
        const attributes = parseXmlAttributes(opening);
        const selfClosing = /\/\s*$/u.test(opening);
        let body = "";
        let nextCursor = tagEnd + 1;
        if (!selfClosing) {
            const close = xml.indexOf("</testcase>", tagEnd + 1);
            if (close === -1) break;
            body = xml.slice(tagEnd + 1, close);
            nextCursor = close + "</testcase>".length;
        }
        const durationSeconds = Number.parseFloat(attributes.time ?? "0");
        cases.push(
            Object.freeze({
                file: normalizeRepositoryPath(attributes.file ?? attributes.classname ?? ""),
                name: attributes.name ?? "(unnamed test)",
                status: /<(?:failure|error)\b/iu.test(body)
                    ? "failed"
                    : /<skipped\b/iu.test(body)
                      ? "skipped"
                      : "passed",
                durationMs: Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds * 1000) : 0
            })
        );
        cursor = nextCursor;
    }
    return cases;
}

function matchCaseFile(location: string, files: ReadonlyArray<string>): string | null {
    const normalized = normalizeRepositoryPath(location);
    const suffixMatches = files.filter((file) => normalized.endsWith(file));
    if (suffixMatches.length === 1) return suffixMatches[0] ?? null;
    const basename = path.posix.basename(normalized);
    const basenameMatches = files.filter((file) => path.posix.basename(file) === basename);
    return basenameMatches.length === 1 ? (basenameMatches[0] ?? null) : null;
}

function commandFingerprint(args: ParsedArgs): number {
    const fingerprint = computeFingerprint();
    process.stdout.write(`${fingerprint}\n`);
    appendOutputs(args.options["github-output"], { fingerprint });
    return 0;
}

function commandManifest(args: ParsedArgs): number {
    const tests = discoverCanonicalTests();
    if (tests.length === 0 || !tests.includes("test/dist/fixture-suites.js"))
        throw new Error("Canonical test corpus is incomplete.");
    const shardCount = parseInteger(args.options.shards, 5);
    const shards = createBalancedShards(createTestWeights(tests, args.options.history), shardCount);
    const manifest: TestManifest = Object.freeze({
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        tests: Object.freeze(tests),
        shardCount,
        manifestDigest: calculateManifestDigest(tests),
        planDigest: calculatePlanDigest(shards),
        shards: Object.freeze(shards)
    });
    writeJson(args.options.output ?? MANIFEST_FILE, manifest);
    appendOutputs(args.options["github-output"], {
        matrix: JSON.stringify({ shard: shards.map((shard) => shard.name) })
    });
    return 0;
}

function commandShardFiles(args: ParsedArgs): number {
    const manifest = parseManifest(readJson(requireOption(args, "manifest")));
    const shardName = requireOption(args, "shard");
    const shard = manifest.shards.find((candidate) => candidate.name === shardName);
    if (!shard) throw new Error(`Unknown shard ${shardName}.`);
    process.stdout.write(`${shard.files.join("\n")}\n`);
    return 0;
}

function commandStageCompiled(args: ParsedArgs): number {
    const output = requireOption(args, "output");
    const files = [
        ...collectFiles(path.join(process.cwd(), "src")),
        ...collectFiles(path.join(process.cwd(), "test", "dist"))
    ].filter((file) => (file.startsWith("src/") && file.includes("/dist/")) || file.startsWith("test/dist/"));
    for (const file of files) {
        if (
            file.endsWith(".map") ||
            file.endsWith(".d.ts") ||
            file.endsWith(".d.ts.map") ||
            file.endsWith(".tsbuildinfo")
        )
            continue;
        const target = path.join(output, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(file, target);
    }
    if (files.length === 0) throw new Error("No compiled files were staged.");
    return 0;
}

function commandRecordBuild(args: ParsedArgs): number {
    const targetSha = requireOption(args, "target-sha");
    const status = parseInteger(requireOption(args, "status"), 255);
    const timedOut = parseBoolean(args.options["timed-out"]);
    const durationMs = parseInteger(args.options["duration-ms"]);
    const completed = !timedOut && status >= 0 && status < 126;
    const succeeded = completed && status === 0;
    const evidence: BuildEvidence = Object.freeze({
        schemaVersion: SCHEMA_VERSION,
        targetSha,
        command: "pnpm run build",
        completed,
        succeeded,
        status,
        timedOut,
        durationMs,
        testsSkippedReason: succeeded ? null : completed ? "build-failed" : "infrastructure"
    });
    writeJson(path.join(requireOption(args, "report-dir"), BUILD_FILE), evidence);
    appendOutputs(args.options["github-output"], { completed, succeeded, status, timed_out: timedOut });
    return completed ? 0 : 2;
}

function commandRecordLint(args: ParsedArgs): number {
    const reportDirectory = requireOption(args, "report-dir");
    const status = parseInteger(requireOption(args, "status"), 255);
    const timedOut = parseBoolean(args.options["timed-out"]);
    const durationMs = parseInteger(args.options["duration-ms"]);
    const lintValue = readOptionalJson(path.join(reportDirectory, LINT_FILE));
    const completed = Array.isArray(lintValue) && !timedOut && (status === 0 || status === 1);
    writeJson(path.join(reportDirectory, LINT_META_FILE), {
        schemaVersion: SCHEMA_VERSION,
        completed,
        status,
        timedOut,
        durationMs
    });
    return completed ? 0 : 2;
}

function commandRecordShard(args: ParsedArgs): number {
    const manifest = parseManifest(readJson(requireOption(args, "manifest")));
    const shardName = requireOption(args, "shard");
    const shard = manifest.shards.find((candidate) => candidate.name === shardName);
    if (!shard) throw new Error(`Unknown shard ${shardName}.`);
    const reportDirectory = requireOption(args, "report-dir");
    const status = parseInteger(requireOption(args, "status"), 255);
    const timedOut = parseBoolean(args.options["timed-out"]);
    const durationMs = parseInteger(args.options["duration-ms"]);
    const reportFile = `tests-${shardName}.xml`;
    const reportPath = path.join(reportDirectory, reportFile);
    let xml = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : "";
    let junitComplete =
        xml.includes("<testsuites") && xml.includes("</testsuites>") && !xml.includes(INFRA_JUNIT_MARKER);
    if (!junitComplete && (timedOut || status > 1)) {
        const reason = timedOut
            ? "Shard wall-clock watchdog expired."
            : `Node test runner ended abnormally with status ${status}.`;
        xml = `<?xml version="1.0" encoding="utf-8"?><testsuites><testsuite name="${INFRA_JUNIT_MARKER}" tests="1" failures="1"><testcase name="${INFRA_JUNIT_MARKER}"><failure message="${reason}"/></testcase></testsuite></testsuites>\n`;
        fs.mkdirSync(reportDirectory, { recursive: true });
        fs.writeFileSync(reportPath, xml, "utf8");
        junitComplete = false;
    }
    const completed = !timedOut && (status === 0 || status === 1) && junitComplete;
    const evidence: ShardEvidence = Object.freeze({
        schemaVersion: SCHEMA_VERSION,
        shard: shardName,
        completed,
        status,
        timedOut,
        durationMs,
        testFiles: shard.files,
        manifestDigest: manifest.manifestDigest,
        planDigest: manifest.planDigest,
        reportFile
    });
    writeJson(path.join(reportDirectory, `test-${shardName}.json`), evidence);
    return completed ? 0 : 2;
}

function validateBuild(
    value: unknown,
    expectedSha: string
): Readonly<{ valid: boolean; succeeded: boolean; errors: ReadonlyArray<string> }> {
    const errors: Array<string> = [];
    if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION) errors.push("invalid build evidence schema");
    if (!isRecord(value) || value.targetSha !== expectedSha) errors.push("build target SHA mismatch");
    const status = isRecord(value) && typeof value.status === "number" ? value.status : 255;
    const completed = isRecord(value) && value.completed === true;
    const timedOut = isRecord(value) && value.timedOut === true;
    const succeeded = isRecord(value) && value.succeeded === true;
    if (!completed || timedOut || status < 0 || status >= 126) errors.push("build execution incomplete");
    if (succeeded !== (status === 0)) errors.push("build success/status mismatch");
    return Object.freeze({ valid: errors.length === 0, succeeded, errors: Object.freeze(errors) });
}

function commandAssemble(args: ParsedArgs): number {
    const reportDirectory = requireOption(args, "report-dir");
    const targetSha = requireOption(args, "target-sha");
    const fingerprint = requireOption(args, "fingerprint");
    const manifest = parseManifest(readJson(requireOption(args, "manifest")));
    const buildValue = readJson(path.join(reportDirectory, BUILD_FILE));
    const build = validateBuild(buildValue, targetSha);
    const lintMeta = readOptionalJson(path.join(reportDirectory, LINT_META_FILE));
    let complete =
        build.valid &&
        build.succeeded &&
        isRecord(lintMeta) &&
        lintMeta.completed === true &&
        [0, 1].includes(Number(lintMeta.status));
    const cases: Array<TestCaseEvidence> = [];
    const durations = new Map<string, number>();
    const shardRows: Array<JsonRecord> = [];
    for (const shard of manifest.shards) {
        const metadataValue = readOptionalJson(path.join(reportDirectory, `test-${shard.name}.json`));
        const metadata = isRecord(metadataValue) ? metadataValue : {};
        const reportFile = typeof metadata.reportFile === "string" ? metadata.reportFile : `tests-${shard.name}.xml`;
        const xmlPath = path.join(reportDirectory, reportFile);
        const xml = fs.existsSync(xmlPath) ? fs.readFileSync(xmlPath, "utf8") : "";
        const assignedFiles = Array.isArray(metadata.testFiles)
            ? metadata.testFiles.filter((entry): entry is string => typeof entry === "string")
            : [];
        const validShard =
            metadata.schemaVersion === SCHEMA_VERSION &&
            metadata.shard === shard.name &&
            metadata.completed === true &&
            [0, 1].includes(Number(metadata.status)) &&
            metadata.manifestDigest === manifest.manifestDigest &&
            metadata.planDigest === manifest.planDigest &&
            JSON.stringify([...assignedFiles].sort()) === JSON.stringify([...shard.files].sort()) &&
            xml.includes("<testsuites") &&
            xml.includes("</testsuites>") &&
            !xml.includes(INFRA_JUNIT_MARKER);
        if (!validShard) complete = false;
        const shardCases = parseJunitCases(xml);
        const attributed = new Map<string, number>();
        for (const testCase of shardCases) {
            const canonicalFile = matchCaseFile(testCase.file, shard.files) ?? testCase.file;
            cases.push(Object.freeze({ ...testCase, file: canonicalFile, shard: shard.name }));
            const matchedFile = matchCaseFile(testCase.file, shard.files);
            if (matchedFile) attributed.set(matchedFile, (attributed.get(matchedFile) ?? 0) + testCase.durationMs);
        }
        const shardDuration = typeof metadata.durationMs === "number" ? metadata.durationMs : 0;
        const fallback = shard.files.length > 0 ? shardDuration / shard.files.length : 1000;
        for (const file of shard.files)
            durations.set(file, Math.max(1, Math.round(attributed.get(file) ?? fallback ?? 1000)));
        shardRows.push({
            name: shard.name,
            completed: metadata.completed === true,
            status: Number(metadata.status ?? 2),
            timedOut: metadata.timedOut === true,
            durationMs: shardDuration,
            testFileCount: shard.files.length
        });
    }
    const report = {
        schemaVersion: SCHEMA_VERSION,
        completed: complete,
        targetSha,
        toolingFingerprint: fingerprint,
        buildStatus: isRecord(buildValue) ? Number(buildValue.status ?? 255) : 255,
        lintStatus: isRecord(lintMeta) ? Number(lintMeta.status ?? 255) : 255,
        testStatus: complete ? Math.max(0, ...shardRows.map((row) => Number(row.status))) : 2,
        manifestDigest: manifest.manifestDigest,
        planDigest: manifest.planDigest,
        shardCount: manifest.shardCount,
        testFileCount: manifest.tests.length,
        testCaseCount: cases.length,
        shards: shardRows
    };
    writeJson(path.join(reportDirectory, REPORT_FILE), report);
    writeJson(path.join(reportDirectory, MANIFEST_FILE), manifest);
    writeJson(path.join(reportDirectory, CASES_FILE), cases);
    writeJson(path.join(reportDirectory, TIMINGS_FILE), {
        schemaVersion: 2,
        targetSha,
        fileDurations: manifest.tests.map((file) => ({ file, durationMs: durations.get(file) ?? 1000 }))
    });
    return complete ? 0 : 2;
}

function validateEvidenceDirectory(
    reportDirectory: string,
    expectedSha: string,
    expectedFingerprint: string
): Readonly<{ valid: boolean; kind: "full" | "build-failure" | "invalid"; errors: ReadonlyArray<string> }> {
    const buildValue = readOptionalJson(path.join(reportDirectory, BUILD_FILE));
    const build = validateBuild(buildValue, expectedSha);
    if (!build.valid) return Object.freeze({ valid: false, kind: "invalid", errors: build.errors });
    if (!build.succeeded) return Object.freeze({ valid: true, kind: "build-failure", errors: Object.freeze([]) });
    const errors: Array<string> = [];
    const report = readOptionalJson(path.join(reportDirectory, REPORT_FILE));
    const lint = readOptionalJson(path.join(reportDirectory, LINT_FILE));
    const cases = readOptionalJson(path.join(reportDirectory, CASES_FILE));
    let manifest: TestManifest | null = null;
    try {
        manifest = parseManifest(readJson(path.join(reportDirectory, MANIFEST_FILE)));
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }
    if (
        !isRecord(report) ||
        report.schemaVersion !== SCHEMA_VERSION ||
        report.completed !== true ||
        report.targetSha !== expectedSha
    )
        errors.push("full report is incomplete or targets the wrong SHA");
    if (isRecord(report) && report.toolingFingerprint !== expectedFingerprint)
        errors.push("trusted tooling fingerprint mismatch");
    if (!Array.isArray(lint) || !Array.isArray(cases)) errors.push("lint or normalized test-case evidence is missing");
    if (
        manifest &&
        isRecord(report) &&
        (report.manifestDigest !== manifest.manifestDigest || report.planDigest !== manifest.planDigest)
    )
        errors.push("report/manifest digest mismatch");
    return Object.freeze({
        valid: errors.length === 0,
        kind: errors.length === 0 ? "full" : "invalid",
        errors: Object.freeze(errors)
    });
}

function commandValidate(args: ParsedArgs): number {
    const result = validateEvidenceDirectory(
        requireOption(args, "report-dir"),
        requireOption(args, "expected-sha"),
        requireOption(args, "expected-fingerprint")
    );
    for (const error of result.errors) process.stderr.write(`Invalid auto-merge evidence: ${error}\n`);
    appendOutputs(args.options["github-output"], { valid: result.valid, kind: result.kind });
    return result.valid ? 0 : 1;
}

function commandPromote(args: ParsedArgs): number {
    const sourceDirectory = requireOption(args, "source-dir");
    const targetDirectory = requireOption(args, "target-dir");
    const sourceSha = requireOption(args, "source-sha");
    const targetSha = requireOption(args, "target-sha");
    const fingerprint = requireOption(args, "expected-fingerprint");
    const source = validateEvidenceDirectory(sourceDirectory, sourceSha, fingerprint);
    if (!source.valid || source.kind !== "full") throw new Error("Only complete full evidence may be promoted.");
    fs.rmSync(targetDirectory, { recursive: true, force: true });
    fs.cpSync(sourceDirectory, targetDirectory, { recursive: true, force: true });
    for (const filename of [BUILD_FILE, REPORT_FILE, TIMINGS_FILE]) {
        const file = path.join(targetDirectory, filename);
        const value = readOptionalJson(file);
        if (!isRecord(value)) continue;
        writeJson(file, { ...value, targetSha, promotedFromSha: sourceSha });
    }
    const promoted = validateEvidenceDirectory(targetDirectory, targetSha, fingerprint);
    if (!promoted.valid || promoted.kind !== "full")
        throw new Error(`Promoted evidence is invalid: ${promoted.errors.join("; ")}`);
    return 0;
}

function selfTest(): void {
    const tricky =
        '<?xml version="1.0"?><testsuites><testsuite>' +
        '<testcase name="converts &lt;command> into help" file="/repo/a.test.js" time="0.1"/>' +
        '<testcase name="skip" file="/repo/a.test.js"><skipped/></testcase>' +
        '<testcase name="fail" file="/repo/a.test.js"><failure message="x"/></testcase>' +
        "</testsuite></testsuites>";
    const parsed = parseJunitCases(tricky);
    assert.equal(parsed.length, 3);
    assert.deepEqual(
        parsed.map((entry) => entry.status),
        ["passed", "skipped", "failed"]
    );
    const shards = createBalancedShards(
        [
            { file: "a", weightMs: 20 },
            { file: "b", weightMs: 10 }
        ],
        2
    );
    assert.equal(new Set(shards.flatMap((shard) => shard.files)).size, 2);
    process.stdout.write("ci-automerge evidence self-test passed\n");
}

const commands: Readonly<Record<string, (args: ParsedArgs) => number>> = Object.freeze({
    fingerprint: commandFingerprint,
    manifest: commandManifest,
    "shard-files": commandShardFiles,
    "stage-compiled": commandStageCompiled,
    "record-build": commandRecordBuild,
    "record-lint": commandRecordLint,
    "record-shard": commandRecordShard,
    assemble: commandAssemble,
    validate: commandValidate,
    promote: commandPromote
});

function main(): number {
    const [command = "", ...rest] = process.argv.slice(2);
    if (command === "self-test") {
        selfTest();
        return 0;
    }
    const handler = commands[command];
    if (!handler) throw new Error(`Unknown ci-automerge-evidence command: ${command || "(missing)"}`);
    return handler(parseArguments(rest));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = main();
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
        process.exitCode = 2;
    }
}
