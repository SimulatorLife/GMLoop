import assert from "node:assert/strict";
import { test } from "node:test";

import {
    clearIdentifierMetadataCache,
    loadDeprecatedIdentifierEntries,
    resetReservedIdentifierMetadataLoader,
    setReservedIdentifierMetadataLoader
} from "../src/resources/gml-identifier-loading.js";

test.afterEach(() => {
    resetReservedIdentifierMetadataLoader();
    clearIdentifierMetadataCache();
});

void test("loadDeprecatedIdentifierEntries normalizes deprecated replacement metadata", () => {
    setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            array_length_2d: {
                type: "Function",
                deprecated: true,
                replacement: "array_length",
                replacementKind: "direct-rename",
                legacyCategory: "Deprecated Arrays",
                legacyUsage: "call",
                diagnosticOwner: "gml"
            },
            background_index: {
                type: "variable",
                deprecated: true,
                replacementKind: "manual-migration",
                legacyCategory: "Backgrounds",
                legacyUsage: "indexed-identifier"
            },
            active_identifier: {
                type: "variable",
                deprecated: false
            }
        }
    }));

    const entries = loadDeprecatedIdentifierEntries();

    assert.deepEqual(entries, [
        {
            name: "array_length_2d",
            type: "function",
            replacement: "array_length",
            replacementKind: "direct-rename",
            legacyCategory: "Deprecated Arrays",
            legacyUsage: "call",
            diagnosticOwner: "gml",
            descriptor: {
                type: "Function",
                deprecated: true,
                replacement: "array_length",
                replacementKind: "direct-rename",
                legacyCategory: "Deprecated Arrays",
                legacyUsage: "call",
                diagnosticOwner: "gml"
            }
        },
        {
            name: "background_index",
            type: "variable",
            replacement: null,
            replacementKind: "manual-migration",
            legacyCategory: "Backgrounds",
            legacyUsage: "indexed-identifier",
            diagnosticOwner: null,
            descriptor: {
                type: "variable",
                deprecated: true,
                replacementKind: "manual-migration",
                legacyCategory: "Backgrounds",
                legacyUsage: "indexed-identifier"
            }
        }
    ]);
});

void test("loadDeprecatedIdentifierEntries caches the normalized entry array", () => {
    setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            os_win32: {
                type: "literal",
                deprecated: true,
                replacement: "os_windows",
                legacyUsage: "identifier"
            }
        }
    }));

    const firstCall = loadDeprecatedIdentifierEntries();
    const secondCall = loadDeprecatedIdentifierEntries();

    assert.strictEqual(firstCall, secondCall);
});
