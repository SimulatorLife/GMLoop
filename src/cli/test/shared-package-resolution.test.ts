import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
    getPackageJsonStringField,
    parsePackageJsonContents,
    readPackageJson,
    resolveCandidateRoot,
    resolvePackageJsonPath
} from "../src/shared/package-resolution.js";

void describe("shared package resolution utilities", () => {
    void it("resolveCandidateRoot returns null for falsy inputs", () => {
        assert.strictEqual(resolveCandidateRoot(null), null);
        assert.strictEqual(resolveCandidateRoot(undefined), null);
        assert.strictEqual(resolveCandidateRoot(""), null);
    });

    void it("resolveCandidateRoot resolves and normalizes paths", () => {
        const result = resolveCandidateRoot("/some/path");
        assert.ok(result);
        assert.strictEqual(result.root, path.resolve("/some/path"));
        assert.strictEqual(result.packageName, null);
        assert.strictEqual(result.packageJson, null);
    });

    void it("readPackageJson reads and parses package.json files", async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pkg-test-"));
        const pkgPath = path.join(tmpDir, "package.json");
        const pkgData = { name: "test-package", version: "1.0.0" };

        try {
            await fs.writeFile(pkgPath, JSON.stringify(pkgData));
            const result = await readPackageJson(pkgPath);
            assert.deepStrictEqual(result, pkgData);
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    void it("parsePackageJsonContents validates package payloads reused by sync readers", () => {
        const packageJson = parsePackageJsonContents(
            JSON.stringify({ name: "test-package", version: "1.0.0" }),
            "/tmp/package.json"
        );

        assert.deepStrictEqual(packageJson, { name: "test-package", version: "1.0.0" });
    });

    void it("readPackageJson throws for invalid JSON", async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pkg-test-"));
        const pkgPath = path.join(tmpDir, "package.json");

        try {
            await fs.writeFile(pkgPath, "invalid json{");
            await assert.rejects(async () => {
                await readPackageJson(pkgPath);
            }, SyntaxError);
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    void it("readPackageJson rejects non-object JSON payloads", async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pkg-test-"));
        const pkgPath = path.join(tmpDir, "package.json");

        try {
            await fs.writeFile(pkgPath, JSON.stringify(["not", "an", "object"]));
            await assert.rejects(
                async () => {
                    await readPackageJson(pkgPath);
                },
                (error) =>
                    error instanceof TypeError && error.message.includes("Expected package.json to contain an object")
            );
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    void it("readPackageJson rejects non-string name fields", async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pkg-test-"));
        const pkgPath = path.join(tmpDir, "package.json");

        try {
            await fs.writeFile(pkgPath, JSON.stringify({ name: 42 }));
            await assert.rejects(
                async () => {
                    await readPackageJson(pkgPath);
                },
                (error) =>
                    error instanceof TypeError &&
                    error.message.includes("package.json field 'name' must be a non-empty string")
            );
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    void it("readPackageJson rejects non-string version fields", async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pkg-test-"));
        const pkgPath = path.join(tmpDir, "package.json");

        try {
            await fs.writeFile(pkgPath, JSON.stringify({ name: "test-package", version: "" }));
            await assert.rejects(
                async () => {
                    await readPackageJson(pkgPath);
                },
                (error) =>
                    error instanceof TypeError &&
                    error.message.includes("package.json field 'version' must be a non-empty string")
            );
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    void it("getPackageJsonStringField returns trimmed strings and null for missing fields", () => {
        const packageJson = { name: "  @gmloop/cli  ", version: "1.2.3" };

        assert.strictEqual(getPackageJsonStringField(packageJson, "name"), "@gmloop/cli");
        assert.strictEqual(getPackageJsonStringField(packageJson, "private"), null);
    });

    void it("resolvePackageJsonPath resolves installed workspace packages via the ESM resolver", () => {
        const packageJsonPath = resolvePackageJsonPath("@gmloop/core", "core");

        assert.strictEqual(path.basename(packageJsonPath), "package.json");
        assert.strictEqual(packageJsonPath.includes(`${path.sep}src${path.sep}core${path.sep}`), true);
    });

    void it("resolvePackageJsonPath throws for unknown packages", () => {
        assert.throws(
            () => resolvePackageJsonPath("nonexistent-package-12345", "test"),
            (error) => error instanceof Error && error.message.includes("Unable to resolve test package")
        );
    });

    void it("resolvePackageJsonPath includes context in error message", () => {
        try {
            resolvePackageJsonPath("nonexistent-package-12345", "manual");
            assert.fail("Should have thrown");
        } catch (error) {
            assert.ok(error.message.includes("manual package"));
        }
    });
});
