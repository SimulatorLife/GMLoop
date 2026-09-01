import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { collectUniqueAncestorDirectories } from "../src/shared/ancestor-directories.js";

void test("collectUniqueAncestorDirectories deduplicates ancestors across inputs", () => {
    const base = path.join(process.cwd(), "tmp", "cli-path-utils", "unique");
    const first = path.join(base, "project", "src");
    const second = path.join(base, "project", "test");

    const result = collectUniqueAncestorDirectories([first, second]);

    const resolvedFirst = path.resolve(first);
    const resolvedSecond = path.resolve(path.join(base, "project"));
    const expectedRoot = path.parse(resolvedFirst).root;

    assert.strictEqual(result[0], resolvedFirst);
    assert.strictEqual(result.includes(resolvedSecond), true);
    assert.strictEqual(result.includes(expectedRoot), true);
});

void test("collectUniqueAncestorDirectories accepts a bare string", () => {
    const base = path.join(process.cwd(), "tmp", "cli-path-utils", "string");
    const nested = path.join(base, "src", "index.gml");

    const result = collectUniqueAncestorDirectories(nested);

    const resolved = path.resolve(nested);
    const expectedRoot = path.parse(resolved).root;

    assert.strictEqual(result[0], resolved);
    assert.strictEqual(result.includes(expectedRoot), true);
});

void test("collectUniqueAncestorDirectories orders and deduplicates ancestors", () => {
    const projectRoot = path.join(process.cwd(), "tmp", "cli-path-utils");
    const nestedFeature = path.join(projectRoot, "src", "features", "core");
    const nestedSibling = path.join(projectRoot, "src", "features", "extras");

    const result = collectUniqueAncestorDirectories([nestedFeature, nestedSibling]);

    const firstChain = [];
    let current = path.resolve(nestedFeature);
    while (true) {
        firstChain.push(current);
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    const secondChain = [];
    current = path.resolve(nestedSibling);
    while (true) {
        secondChain.push(current);
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    const expected = firstChain.concat(secondChain.filter((directory) => !firstChain.includes(directory)));

    assert.deepStrictEqual(result, expected);
    assert.strictEqual(new Set(result).size, result.length);
    assert.ok(result.includes(path.parse(result[0]).root));
});

void test("collectUniqueAncestorDirectories skips empty inputs", () => {
    const projectRoot = path.join(process.cwd(), "tmp", "cli-path-utils");
    const result = collectUniqueAncestorDirectories([null, undefined, "", projectRoot]);

    assert.strictEqual(result[0], path.resolve(projectRoot));
});
