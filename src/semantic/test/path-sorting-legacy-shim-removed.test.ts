/**
 * Regression guard: the legacy inline `normalizeTrackedPath` helper and its
 * duplicate `\\\\` → `/` rewrite in `recordCrossPathDependencyEdge` have been
 * removed from `src/semantic/src/scopes/path-sorting.ts`. Both call sites now
 * route through `Core.toPosixPath`, which is the canonical long-term
 * implementation owned by `@gmloop/core`.
 *
 * Why this guard exists
 * ---------------------
 * The removed helpers were an inline duplicate of the public
 * `Core.toPosixPath` implementation. Keeping two copies meant the scope
 * tracker could drift from the rest of the monorepo (any future tweak to the
 * canonical Core implementation would silently miss this module), and the
 * duplicate in `recordCrossPathDependencyEdge` was even terser than the
 * canonical version, accepting fewer input shapes than the rest of the
 * workspace.
 *
 * If anyone re-introduces a local `normalizeTrackedPath` helper or re-inlines
 * the `replaceAll("\\\\", "/")` rewrite in `path-sorting.ts`, the assertions
 * below fail loudly so the cleanup can be re-applied.
 *
 * (target-state.md §2.3 — no backward-compatibility shims; the semantic
 * workspace must consume the canonical Core path utilities.)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";

import {
    buildPathLevelDependencyGraph,
    collectNormalisedInputPaths,
    topologicallySortPaths
} from "../src/scopes/path-sorting.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PATH_SORTING_SOURCE_PATH = path.resolve(REPOSITORY_ROOT, "src/semantic/src/scopes/path-sorting.ts");

void describe("path-sorting legacy shim removal", () => {
    void it("does not declare a local normalizeTrackedPath helper", async () => {
        const source = await readFile(PATH_SORTING_SOURCE_PATH, "utf8");

        assert.doesNotMatch(
            source,
            /function\s+normalizeTrackedPath\b/u,
            "path-sorting.ts must not declare a local normalizeTrackedPath helper; " +
                "use Core.toPosixPath directly so the canonical Core contract is the single source of truth."
        );
    });

    void it("does not inline the legacy backslash rewrite", async () => {
        const source = await readFile(PATH_SORTING_SOURCE_PATH, "utf8");

        assert.doesNotMatch(
            source,
            /\.replaceAll\(\s*["']\\\\["']/u,
            "path-sorting.ts must not inline the legacy backslash → forward-slash rewrite; " +
                "delegate to Core.toPosixPath instead."
        );

        assert.doesNotMatch(
            source,
            /\.replaceAll\(\s*["']\\\\\\["']/u,
            "path-sorting.ts must not inline the legacy backslash → forward-slash rewrite; " +
                "delegate to Core.toPosixPath instead."
        );
    });

    void it("imports Core from @gmloop/core so toPosixPath is reachable", async () => {
        const source = await readFile(PATH_SORTING_SOURCE_PATH, "utf8");

        assert.match(
            source,
            /import\s*\{\s*Core\s*\}\s*from\s*["']@gmloop\/core["']/u,
            "path-sorting.ts must import Core from @gmloop/core so Core.toPosixPath is the canonical path-normalization entry point."
        );
    });

    void it("delegates collectNormalisedInputPaths to Core.toPosixPath", () => {
        const windowsPath = String.raw`\project\a.gml`;
        const posixPath = "/project/a.gml";
        const windowsNested = String.raw`C:\nested\dir\b.gml`;
        const result = collectNormalisedInputPaths([windowsPath, posixPath, windowsNested, ""]);

        assert.equal(result.size, 2, "backslash and forward-slash variants must collapse");
        // The first input wins for the duplicate normalized key.
        assert.equal(result.get(Core.toPosixPath(windowsPath)), windowsPath);
        assert.equal(result.get(Core.toPosixPath(windowsNested)), windowsNested);
        assert.ok(!result.has(""), "empty input must be dropped");
    });

    void it("keeps cross-path edge resolution consistent with Core.toPosixPath", () => {
        // A declares `helper`; B references `helper` from a different file
        // scope. The dependency graph must use POSIX-normalized paths so the
        // edge is recorded even when the declaring scope was registered with
        // a Windows-style separator.
        const edges = new Map<string, Set<string>>();
        const inDegree = new Map<string, number>();
        const declaringOriginalPath = String.raw`C:\project\a.gml`;
        const inputPaths = new Map<string, string>([
            ["/a.gml", declaringOriginalPath],
            ["/b.gml", "/project/b.gml"]
        ]);

        const pathToScopesIndex = new Map<string, Set<string>>([
            ["/a.gml", new Set(["scope-a"])],
            ["/b.gml", new Set(["scope-b"])]
        ]);
        const scopesById = new Map<
            string,
            {
                metadata: { path: string };
                occurrences: Map<string, { references: unknown[] }>;
                symbolMetadata: Map<string, unknown>;
            }
        >([
            [
                "scope-a",
                {
                    metadata: { path: declaringOriginalPath },
                    occurrences: new Map(),
                    symbolMetadata: new Map()
                }
            ],
            [
                "scope-b",
                {
                    metadata: { path: "/project/b.gml" },
                    occurrences: new Map([["helper", { references: [{}] }]]),
                    symbolMetadata: new Map()
                }
            ]
        ]);

        const { edges: builtEdges, inDegree: builtInDegree } = buildPathLevelDependencyGraph(
            inputPaths,
            pathToScopesIndex,
            scopesById as never,
            (name) => (name === "helper" ? "scope-a" : null)
        );

        for (const [pathKey, neighbours] of builtEdges) {
            edges.set(pathKey, new Set(neighbours));
        }
        for (const [pathKey, degree] of builtInDegree) {
            inDegree.set(pathKey, degree);
        }

        const sorted = topologicallySortPaths(inputPaths, edges, inDegree);
        assert.deepStrictEqual(sorted, [declaringOriginalPath, "/project/b.gml"]);
    });
});
