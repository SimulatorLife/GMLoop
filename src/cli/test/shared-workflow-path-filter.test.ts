import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { createWorkflowPathFilter, ensureManualWorkflowArtifactsAllowed } from "../src/workflow/path-filter.js";

void describe("workflow path filter helpers", () => {
    void it("allows paths that satisfy the workflow filters", () => {
        const workspace = path.resolve("/tmp", "workflow-path-filter", "allowed");
        const outputPath = path.join(workspace, "artefacts", "manual.json");
        const filter = createWorkflowPathFilter({ allowPaths: [workspace] });

        assert.doesNotThrow(() => {
            ensureManualWorkflowArtifactsAllowed(filter, {
                cacheRoot: workspace,
                outputPath
            });
        });
    });

    void it("allows any path when no allow list is provided", () => {
        const workspace = path.resolve("/tmp", "workflow-path-filter", "open");
        const filter = createWorkflowPathFilter();

        assert.equal(filter.allowList.length, 0);
        assert.equal(filter.denyList.length, 0);
        assert.ok(filter.allowsDirectory(workspace));
        assert.ok(filter.allowsPath(path.join(workspace, "file.json")));
    });

    void it("preserves Windows absolute allow paths on non-Windows hosts", () => {
        const workspace = path.win32.join("C:\\", "workflow-path-filter", "allowed");
        const outputPath = path.win32.join(workspace, "artefacts", "manual.json");
        const filter = createWorkflowPathFilter({ allowPaths: [workspace] });

        assert.deepStrictEqual(filter.allowList, [workspace]);
        assert.ok(filter.allowsDirectory(workspace));
        assert.ok(filter.allowsPath(outputPath));
    });

    void it("preserves UNC deny paths on non-Windows hosts", () => {
        const restricted = String.raw`\\server\share\workflow-path-filter\restricted`;
        const filter = createWorkflowPathFilter({ denyPaths: [restricted] });

        assert.equal(filter.denyList[0], restricted);
        assert.equal(filter.allowsPath(String.raw`${restricted}\manual.json`), false);
    });

    void it("accepts UNC allow paths written with forward slashes", () => {
        const workspace = "//server/share/workflow-path-filter/allowed";
        const outputPath = "//SERVER/SHARE/workflow-path-filter/allowed/manual.json";
        const filter = createWorkflowPathFilter({ allowPaths: [workspace] });

        assert.deepStrictEqual(filter.allowList, [String.raw`\\server\share\workflow-path-filter\allowed`]);
        assert.ok(filter.allowsPath(outputPath));
    });

    void it("uses only canonical allowPaths/denyPaths inputs", () => {
        const root = path.resolve("/tmp", "workflow-path-filter", "canonical");
        const allowed = path.join(root, "allowed");
        const denied = path.join(allowed, "denied");

        const filter = createWorkflowPathFilter({
            allowPaths: [allowed],
            denyPaths: [denied]
        });

        assert.ok(filter.allowsDirectory(allowed));
        assert.ok(filter.allowsPath(path.join(allowed, "manual.json")));
        assert.equal(filter.allowsPath(path.join(denied, "manual.json")), false);
    });

    void it("rejects directories outside the workflow filters", () => {
        const root = path.resolve("/tmp", "workflow-path-filter", "root");
        const allowed = path.join(root, "allowed");
        const denied = path.join(root, "denied");
        const filter = createWorkflowPathFilter({
            allowPaths: [allowed],
            denyPaths: [denied]
        });

        assert.throws(
            () => {
                ensureManualWorkflowArtifactsAllowed(filter, {
                    cacheRoot: denied
                });
            },
            (error) =>
                error instanceof Error && /Manual cache root/.test(error.message) && error.message.includes(denied)
        );
    });

    void it("rejects files outside the workflow filters", () => {
        const restricted = path.resolve("/tmp", "workflow-path-filter", "restricted");
        const filter = createWorkflowPathFilter({ denyPaths: [restricted] });

        assert.throws(
            () => {
                ensureManualWorkflowArtifactsAllowed(filter, {
                    outputPath: path.join(restricted, "manual.json")
                });
            },
            (error) =>
                error instanceof Error && /Manual output path/.test(error.message) && error.message.includes(restricted)
        );
    });
});
