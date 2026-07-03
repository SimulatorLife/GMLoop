import assert from "node:assert/strict";
import { test } from "node:test";

import {
    isReservedGmlBindingIdentifierName,
    loadReservedGmlBindingIdentifierNames,
    loadReservedIdentifierNames,
    resetReservedIdentifierMetadataLoader,
    setReservedIdentifierMetadataLoader
} from "../src/resources/gml-identifier-loading.js";

function toSortedArray(values: Iterable<unknown>) {
    return Array.from(values).sort();
}

test.afterEach(() => {
    resetReservedIdentifierMetadataLoader();
});

void test("custom metadata loader honours default exclusion filters", () => {
    const cleanup = setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            foo: { type: "Function" },
            bar: { type: "keyword" },
            baz: { type: "literal" },
            quux: { type: "" }
        }
    }));

    const names = loadReservedIdentifierNames();

    assert.deepEqual(toSortedArray(names), ["foo"]);

    cleanup();
});

void test("cleanup handler only restores the active loader", () => {
    const cleanupFirst = setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            foo: { type: "function" }
        }
    }));

    setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            bar: { type: "function" }
        }
    }));

    cleanupFirst();

    const names = loadReservedIdentifierNames();

    assert.ok(names.has("bar"));
    assert.ok(!names.has("foo"));
});

void test("invalid loader input resets to the default implementation", () => {
    const cleanup = setReservedIdentifierMetadataLoader(null);

    assert.equal(typeof cleanup, "function");

    const replacementCleanup = setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            baz: { type: "function" }
        }
    }));

    const names = loadReservedIdentifierNames();

    assert.deepEqual(toSortedArray(names), ["baz"]);

    replacementCleanup();
});

void test("ordinary binding reservation includes metadata identifiers and id fallback", () => {
    const cleanup = setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            draw_sprite: { type: "function" },
            x: { type: "variable" },
            if: { type: "keyword" }
        }
    }));

    const names = loadReservedGmlBindingIdentifierNames("ordinary-binding");

    assert.deepEqual(toSortedArray(names), ["draw_sprite", "id", "if", "x"]);
    assert.equal(isReservedGmlBindingIdentifierName("ID", "ordinary-binding"), true);
    assert.equal(isReservedGmlBindingIdentifierName("player_id", "ordinary-binding"), false);

    cleanup();
});

void test("argument binding reservation stays limited to implicit argument-invalid identifiers", () => {
    const cleanup = setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            id: { type: "variable" },
            self: { type: "literal" },
            other: { type: "literal" },
            global: { type: "literal" },
            x: { type: "variable" },
            pi: { type: "literal" },
            draw_sprite: { type: "function" }
        }
    }));

    const names = loadReservedGmlBindingIdentifierNames("argument-binding");

    assert.deepEqual(toSortedArray(names), ["global", "id", "other", "self"]);
    assert.equal(isReservedGmlBindingIdentifierName("self", "argument-binding"), true);
    assert.equal(isReservedGmlBindingIdentifierName("x", "argument-binding"), false);
    assert.equal(isReservedGmlBindingIdentifierName("pi", "argument-binding"), false);

    cleanup();
});

void test("argument binding reservation keeps id reserved when metadata omits it", () => {
    const cleanup = setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            self: { type: "literal" }
        }
    }));

    const names = loadReservedGmlBindingIdentifierNames("argument-binding");

    assert.deepEqual(toSortedArray(names), ["id", "self"]);

    cleanup();
});

void test("enum member reservation includes keywords and literals without reserving ordinary built-ins", () => {
    const cleanup = setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            if: { type: "keyword" },
            self: { type: "literal" },
            x: { type: "variable" },
            draw_sprite: { type: "function" }
        }
    }));

    const names = loadReservedGmlBindingIdentifierNames("enum-member");

    assert.deepEqual(toSortedArray(names), ["if", "self"]);
    assert.equal(isReservedGmlBindingIdentifierName("if", "enum-member"), true);
    assert.equal(isReservedGmlBindingIdentifierName("x", "enum-member"), false);
    assert.equal(isReservedGmlBindingIdentifierName("draw_sprite", "enum-member"), false);

    cleanup();
});
