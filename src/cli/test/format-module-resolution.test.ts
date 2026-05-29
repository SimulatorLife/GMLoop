import assert from "node:assert/strict";
import test from "node:test";

import { __formatTest__ } from "../src/commands/format.js";

const { isMissingModuleDependencyForTests, resolveModuleDefaultExportForTests } = __formatTest__;

void test("resolveModuleDefaultExport returns the default export when present", () => {
    const namespace = { default: () => "value" };
    const resolved = resolveModuleDefaultExportForTests(namespace);
    assert.strictEqual(typeof resolved, "function");
    if (typeof resolved !== "function") {
        assert.fail("Expected resolved export to be callable");
    }
    assert.strictEqual(resolved(), "value");
});

void test("resolveModuleDefaultExport preserves falsy defaults", () => {
    const namespace = { default: 0 };
    assert.strictEqual(resolveModuleDefaultExportForTests(namespace), 0);
});

void test("resolveModuleDefaultExport falls back to the module for nullish defaults", () => {
    const namespaceWithNull = { default: null, extra: true };
    assert.strictEqual(resolveModuleDefaultExportForTests(namespaceWithNull), namespaceWithNull);

    const namespaceWithUndefined = { default: undefined, value: 42 };
    assert.strictEqual(resolveModuleDefaultExportForTests(namespaceWithUndefined), namespaceWithUndefined);
});

void test("resolveModuleDefaultExport tolerates primitive and null modules", () => {
    assert.strictEqual(resolveModuleDefaultExportForTests(null), null);
    assert.strictEqual(resolveModuleDefaultExportForTests(), undefined);
    assert.strictEqual(resolveModuleDefaultExportForTests("module"), "module");
});

void test("isMissingModuleDependency detects ERR_MODULE_NOT_FOUND errors", () => {
    const error: Error & { code?: string } = new Error("Cannot find module 'prettier'");
    error.code = "ERR_MODULE_NOT_FOUND";

    assert.strictEqual(isMissingModuleDependencyForTests(error, "prettier"), true);
});

void test("isMissingModuleDependency handles double-quoted module identifiers", () => {
    const error: Error & { code?: string } = new Error('Cannot find module "fast-xml-parser"');
    error.code = "ERR_MODULE_NOT_FOUND";

    assert.strictEqual(isMissingModuleDependencyForTests(error, "fast-xml-parser"), true);
});

void test("isMissingModuleDependency returns false for unrelated errors", () => {
    const error: Error & { code?: string } = new Error("Operation failed");
    error.code = "EFAIL";

    assert.strictEqual(isMissingModuleDependencyForTests(error, "prettier"), false);
});

void test("isMissingModuleDependency requires a non-empty module identifier", () => {
    const error: Error & { code?: string } = new Error("Cannot find module ''");
    error.code = "ERR_MODULE_NOT_FOUND";

    assert.throws(() => isMissingModuleDependencyForTests(error, "  "), /moduleId/);
});
