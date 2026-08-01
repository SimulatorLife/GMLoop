import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { Core } from "@gmloop/core";

import { isRuntimeBuiltinAvailable, resolveRuntimeBuiltinFunctions } from "../src/browser/runtime/builtin-functions.js";

const FUNCTION_DECLARATION_PATTERN = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
const FUNCTION_ASSIGNMENT_PATTERN = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*function\b/g;

/**
 * Simple helper to find the repository root by walking up from the current
 * working directory. This mirrors the CLI's findRepoRoot logic but is local
 * to this test file to avoid circular dependencies between workspaces.
 *
 * Note: Intentionally simplified compared to the CLI version - does not validate
 * file types (AGENTS.md as file, .git as directory) since this is only used for
 * test setup where the repository structure is known and valid.
 */
function findRepoRootForTest(startDir: string): string {
    let current = path.resolve(startDir);
    let lastPackageJson: string | null = null;

    while (true) {
        if (fs.existsSync(path.join(current, "AGENTS.md"))) {
            return current;
        }

        if (fs.existsSync(path.join(current, ".git"))) {
            return current;
        }

        if (fs.existsSync(path.join(current, "package.json"))) {
            lastPackageJson = current;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    if (lastPackageJson) {
        return lastPackageJson;
    }

    throw new Error("Repository root not found");
}

function collectRuntimeFunctionNames(functionDir: string): Set<string> {
    const names = new Set<string>();
    const entries = fs.readdirSync(functionDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".js")) {
            continue;
        }

        const filePath = path.join(functionDir, entry.name);
        const contents = fs.readFileSync(filePath, "utf8");

        for (const pattern of [FUNCTION_DECLARATION_PATTERN, FUNCTION_ASSIGNMENT_PATTERN]) {
            for (const match of contents.matchAll(pattern)) {
                const name = match[1];
                if (name) {
                    names.add(name);
                }
            }
        }
    }

    return names;
}

const EXPECTED_RUNTIME_FUNCTIONS = [
    "abs",
    "point_distance",
    "random",
    "irandom_range",
    "string_length",
    "string_upper",
    "string_lower",
    "string_replace",
    "clamp"
];

void test("HTML5 runtime defines core manual builtins used by hot reload", () => {
    const repoRoot = findRepoRootForTest(process.cwd());
    const functionDir = path.join(repoRoot, "vendor", "GameMaker-HTML5", "scripts", "functions");

    assert.ok(
        fs.existsSync(functionDir),
        "HTML5 runtime function sources are missing. Initialize vendor/GameMaker-HTML5."
    );

    const runtimeFunctions = collectRuntimeFunctionNames(functionDir);
    const manualFunctions = Core.loadManualFunctionNames();

    for (const name of EXPECTED_RUNTIME_FUNCTIONS) {
        assert.ok(manualFunctions.has(name), `Manual metadata missing '${name}'`);
        assert.ok(runtimeFunctions.has(name), `HTML5 runtime missing '${name}'`);
    }
});

void test("hot-reload builtin resolution recognizes HTML5 texture handles as pointers", () => {
    const textureHandle = {
        WebGLTexture: {},
        TPE: {},
        toString(): string {
            return "Texture:test.png";
        }
    };
    const fallbackFunctions = resolveRuntimeBuiltinFunctions({});

    assert.equal(fallbackFunctions.is_ptr(textureHandle), true);
    assert.equal(fallbackFunctions.is_ptr(new ArrayBuffer(1)), true);
    assert.equal(fallbackFunctions.is_ptr({}), false);
});

void test("is_ptr accepts cross-realm ArrayBuffers via the duck-typed capability probe", () => {
    // The previous implementation used `value instanceof ArrayBuffer`, which
    // fails for buffers constructed in a different V8 realm because each
    // realm owns its own `ArrayBuffer` constructor. The runtime now delegates
    // to `isArrayBufferLike`, which inspects the documented `byteLength` and
    // `slice` surface and accepts foreign-realm buffers uniformly. This keeps
    // the `is_ptr` contract aligned with `Core.isArrayBufferLike` so any
    // substitute exposing the same surface is recognised without sharing a
    // prototype chain.
    const realm = vm.createContext({});
    const foreignBuffer = vm.runInContext("new ArrayBuffer(8)", realm);
    assert.equal(
        foreignBuffer instanceof ArrayBuffer,
        false,
        "precondition: cross-realm ArrayBuffer must fail realm-local instanceof check"
    );
    assert.equal(Core.isArrayBufferLike(foreignBuffer), true);

    const fallbackFunctions = resolveRuntimeBuiltinFunctions({});
    assert.equal(fallbackFunctions.is_ptr(foreignBuffer), true);
});

void test("is_ptr accepts duck-typed ArrayBuffer substitutes without sharing a prototype chain", () => {
    // Plain objects and `Proxy` wrappers that expose `byteLength` + `slice`
    // are accepted by the `isArrayBufferLike` capability probe even when
    // `value instanceof ArrayBuffer` is `false`. The runtime therefore
    // honours the same contract as `Core.isArrayBufferLike`, allowing browser
    // shims, test doubles, and substitute implementations to participate in
    // pointer classification without inheriting from `ArrayBuffer`.
    const duckTypedBuffer = {
        byteLength: 8,
        slice(): ArrayBuffer {
            return new ArrayBuffer(4);
        }
    };
    assert.equal(duckTypedBuffer instanceof ArrayBuffer, false);
    assert.equal(Core.isArrayBufferLike(duckTypedBuffer), true);

    const fallbackFunctions = resolveRuntimeBuiltinFunctions({});
    assert.equal(fallbackFunctions.is_ptr(duckTypedBuffer), true);
    assert.equal(fallbackFunctions.is_ptr(null), false);
    assert.equal(fallbackFunctions.is_ptr(undefined), false);
    assert.equal(fallbackFunctions.is_ptr(42), false);
    assert.equal(fallbackFunctions.is_ptr({ byteLength: 8 }), false, "missing slice must be rejected");
    assert.equal(
        fallbackFunctions.is_ptr({ slice: () => new ArrayBuffer(0) }),
        false,
        "missing byteLength must be rejected"
    );
});

void test("hot-reload builtin resolution provides a no-op event_inherited fallback", () => {
    // GML `event_inherited()` invokes the same event on the parent object.
    // The live-reload patch replaces a single event function in isolation,
    // so the runtime wrapper provides a no-op fallback instead of letting
    // the call throw "event_inherited is not defined" on the first event
    // that uses it.
    const functions = resolveRuntimeBuiltinFunctions({});
    assert.equal(typeof functions.event_inherited, "function");
    assert.equal(functions.event_inherited(), undefined);
});

void test("hot-reload builtin resolution augments a native is_ptr predicate", () => {
    const textureHandle = {
        WebGLTexture: {},
        TPE: {},
        toString(): string {
            return "Texture:test.png";
        }
    };
    const functions = resolveRuntimeBuiltinFunctions({
        is_ptr: (): boolean => false
    });

    assert.equal(functions.is_ptr(textureHandle), true);
    assert.equal(functions.is_ptr({}), false);
});

void test("hot-reload builtin resolution treats native predicate errors as non-pointers", () => {
    const functions = resolveRuntimeBuiltinFunctions({
        is_ptr(value: unknown): boolean {
            if (value === undefined || value === null) {
                throw new TypeError("native HTML5 is_ptr cannot classify this value");
            }
            return false;
        }
    });

    assert.equal(functions.is_ptr(undefined), false);
    assert.equal(functions.is_ptr(null), false);
});

void test("hot-reload builtin resolution discovers minified HTML5 functions", () => {
    const calls: Array<string> = [];
    const globalScope: Record<string, unknown> = {
        _HL4: {
            self: "self",
            mouse_x: "_mouse_x",
            current_time: "_current_time",
            variable_instance_get: "_variable_instance_get",
            texture_is_ready: "_texture_is_ready"
        },
        _texture_is_ready: () => {
            calls.push("texture_is_ready");
            return true;
        }
    };

    assert.equal(isRuntimeBuiltinAvailable(globalScope, "texture_is_ready"), true);
    assert.equal(isRuntimeBuiltinAvailable(globalScope, "texture_prefetch"), false);

    const functions = resolveRuntimeBuiltinFunctions(globalScope);
    assert.equal(typeof functions.gml_pragma, "function");
    functions.gml_pragma("forceinline");
    assert.deepEqual(calls, []);
});
