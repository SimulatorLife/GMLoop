/**
 * Direct coverage for the public helpers in
 * `src/cli/src/modules/runtime/artifact-store.ts`.
 *
 * The CLI exercises these helpers indirectly through the `replay` and
 * `profile` commands, but pinning their observable behaviour here keeps the
 * refactor that removed the bespoke `stableStringify` wrapper honest and
 * documents the serialization contract future contributors can rely on:
 *
 * - {@link writeArtifactJson} persists payloads with deterministic key
 *   ordering, two-space indentation, and a trailing newline.
 * - {@link createDeterministicArtifactId} hashes the canonical (sorted)
 *   payload bytes with no trailing newline so existing artifact filenames
 *   remain byte-for-byte comparable.
 *
 * Both helpers compose established `Core` utilities
 * (`sortObjectKeys` + `stringifyJsonForFile`); the assertions below verify
 * the composition preserves the previously hand-rolled semantics.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { Core } from "@gmloop/core";

import { createDeterministicArtifactId, writeArtifactJson } from "../src/modules/runtime/artifact-store.js";

let temporaryDirectory: string;

beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-artifact-store-"));
});

afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
});

void describe("writeArtifactJson", () => {
    void it("serializes payloads with sorted keys, two-space indentation, and a trailing newline", async () => {
        const targetPath = path.join(temporaryDirectory, "nested", "artifact.json");
        const payload = {
            zebra: 1,
            alpha: { second: 2, first: 1 },
            middle: [{ d: 4, c: 3 }, "literal"]
        };

        await writeArtifactJson(targetPath, payload);

        const contents = await readFile(targetPath, "utf8");
        assert.equal(
            contents,
            [
                "{",
                '  "alpha": {',
                '    "first": 1,',
                '    "second": 2',
                "  },",
                '  "middle": [',
                "    {",
                '      "c": 3,',
                '      "d": 4',
                "    },",
                '    "literal"',
                "  ],",
                '  "zebra": 1',
                "}",
                ""
            ].join("\n")
        );
    });

    void it("creates intermediate directories that do not yet exist", async () => {
        const targetPath = path.join(temporaryDirectory, "deep", "nested", "dir", "artifact.json");

        await writeArtifactJson(targetPath, { ok: true });

        const contents = await readFile(targetPath, "utf8");
        assert.ok(contents.endsWith("\n"));
        assert.ok(contents.includes('"ok": true'));
    });

    void it("throws a descriptive error when the payload cannot be serialized", async () => {
        const targetPath = path.join(temporaryDirectory, "invalid.json");
        // `undefined` cannot be serialized to JSON; the helper should surface
        // the underlying serialization failure rather than silently emitting
        // a truncated file. The wrapped error message is provided by
        // `Core.stringifyJsonForFile`.
        await assert.rejects(
            () => writeArtifactJson(targetPath, undefined),
            (error: TypeError) => {
                assert.equal(error instanceof TypeError, true);
                assert.match(error.message, /Unable to serialize .* JSON\./);
                return true;
            }
        );

        // Sanity-check: the rejection happens before any file is written.
        await assert.rejects(readFile(targetPath, "utf8"));
    });
});

void describe("createDeterministicArtifactId", () => {
    void it("returns the same id for equivalent payloads regardless of key insertion order", () => {
        const scope = "replay";
        const seed = { input: "payload", name: "default", projectRoot: "/tmp/project" };

        const reordered = {
            projectRoot: "/tmp/project",
            input: "payload",
            name: "default"
        };

        assert.equal(createDeterministicArtifactId(scope, seed), createDeterministicArtifactId(scope, reordered));
    });

    void it("produces distinct ids when any payload field changes", () => {
        const scope = "replay";
        const base = { input: "payload", name: "default", projectRoot: "/tmp/project" };

        assert.notEqual(
            createDeterministicArtifactId(scope, base),
            createDeterministicArtifactId(scope, { ...base, input: "different" })
        );
        assert.notEqual(
            createDeterministicArtifactId(scope, base),
            createDeterministicArtifactId(scope, { ...base, name: "renamed" })
        );
        assert.notEqual(
            createDeterministicArtifactId(scope, base),
            createDeterministicArtifactId(scope, { ...base, projectRoot: "/tmp/other" })
        );
    });

    void it("changes the id when only the scope prefix changes", () => {
        const seed = { input: "payload", name: "default", projectRoot: "/tmp/project" };

        assert.notEqual(createDeterministicArtifactId("replay", seed), createDeterministicArtifactId("profile", seed));
    });

    void it("embeds the scope prefix followed by a 12-character lowercase hex digest", () => {
        const id = createDeterministicArtifactId("replay", { any: "payload" });

        assert.match(id, /^replay-[0-9a-f]{12}$/);
    });

    void it("does not depend on a trailing newline for digest stability", () => {
        // Verifies the helper intentionally hashes the canonical payload
        // bytes (no trailing newline) so legacy artifact filenames derived
        // before the `stableStringify` removal remain byte-for-byte stable.
        const payload = { projectRoot: "/tmp/project", name: "default", input: "payload" };
        const id = createDeterministicArtifactId("replay", payload);
        const expectedHash = createHash("sha256")
            .update(JSON.stringify(Core.sortObjectKeys(payload), null, 2))
            .digest("hex")
            .slice(0, 12);

        assert.equal(id, `replay-${expectedHash}`);
    });

    void it("consistently indexes across thousands of invocations", () => {
        // Sanity check: the helper must remain deterministic under repeated
        // calls. A regression here would invalidate any persisted artifact
        // index that depends on the digest remaining stable.
        const payload = { metric: 42, projectRoot: "/tmp/project" };
        const first = createDeterministicArtifactId("profile", payload);

        for (let index = 0; index < 1000; index += 1) {
            assert.equal(createDeterministicArtifactId("profile", payload), first);
        }
    });
});
