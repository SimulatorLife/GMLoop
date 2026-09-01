/**
 * Regression guard for the lean `defaultGmlFormatProvider` bundle.
 *
 * Two pointless private aliases used to sit between the resolver and
 * `defaultGmlFormatProvider`:
 *
 * - `default-format-adapters.ts` declared `DEFAULT_PRINTER_LAYOUT_DEFAULTS`
 *   as a literal rename of the imported `DEFAULT_GML_PRINTER_LAYOUT_DEFAULTS`
 *   and only consumed it once inside the resolver's
 *   `resolvePrinterLayoutDefaults` field. Removing the alias is a pure
 *   rename; the resolver still returns the canonical defaults.
 * - `default-format-components.ts` declared `DEFAULT_PRETTIER_OPTIONS` as
 *   `Object.freeze(defaultGmlFormatAdapterResolver.resolvePrettierDefaults())`
 *   and only consumed it once inside `defaultGmlFormatProvider.prettierDefaults`.
 *   The outer `Object.freeze` is redundant because the resolver already
 *   returns a frozen value, and the local constant hides the seam that
 *   the rest of the file goes through. Inlining the resolver call makes
 *   the provider's construction obvious.
 *
 * These tests assert the simplified paths still expose the canonical
 * defaults, so a future contributor reintroducing one of the removed
 * aliases (or freezing an already-frozen value) gets immediate feedback.
 *
 * (target-state.md §2.3, §3.2 — orchestration depends on abstractions,
 * not concrete adapters.)
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultGmlFormatAdapterResolver } from "../src/components/default-format-adapters.js";
import {
    createDefaultGmlFormatComponents,
    createDefaultGmlFormatProvider,
    defaultGmlFormatProvider
} from "../src/components/default-format-components.js";
import { DEFAULT_GML_PRINTER_LAYOUT_DEFAULTS } from "../src/components/printer-layout-defaults.js";
import { DEFAULT_PRINT_WIDTH, DEFAULT_TAB_WIDTH } from "../src/printer/constants.js";

async function noopSourceFormatter(): Promise<string> {
    return "formatted-by-test";
}

function noopNormalizer(_formatted: string): string {
    return "normalized-by-test";
}

void test("resolver returns the canonical printer layout defaults without an intermediate alias", () => {
    const resolved = defaultGmlFormatAdapterResolver.resolvePrinterLayoutDefaults();

    assert.strictEqual(resolved, DEFAULT_GML_PRINTER_LAYOUT_DEFAULTS);
    assert.strictEqual(resolved.printWidth, DEFAULT_PRINT_WIDTH);
    assert.strictEqual(resolved.tabWidth, DEFAULT_TAB_WIDTH);
    assert.ok(Object.isFrozen(resolved), "printer layout defaults must remain frozen");
});

void test("defaultGmlFormatProvider.prettierDefaults is sourced directly from the resolver", () => {
    const providerPrettierDefaults = defaultGmlFormatProvider.prettierDefaults;
    const resolverPrettierDefaults = defaultGmlFormatAdapterResolver.resolvePrettierDefaults();

    assert.strictEqual(
        providerPrettierDefaults,
        resolverPrettierDefaults,
        "provider must reuse the resolver's frozen defaults by reference"
    );
    assert.ok(Object.isFrozen(providerPrettierDefaults), "provider prettier defaults must remain frozen");
    assert.strictEqual(providerPrettierDefaults.tabWidth, DEFAULT_TAB_WIDTH);
    assert.strictEqual(providerPrettierDefaults.printWidth, DEFAULT_PRINT_WIDTH);
    assert.strictEqual(providerPrettierDefaults.semi, true);
    assert.strictEqual(providerPrettierDefaults.bracketSpacing, false);
    assert.strictEqual(providerPrettierDefaults.singleQuote, false);
});

void test("createDefaultGmlFormatProvider honours an injected resolver and components bundle", () => {
    let resolveCalls = 0;
    const customLayoutDefaults = Object.freeze({ printWidth: 88, tabWidth: 2 });
    const resolver = {
        resolveAdapters: () => {
            resolveCalls += 1;
            return defaultGmlFormatAdapterResolver.resolveAdapters();
        },
        resolvePrettierDefaults: () => ({
            tabWidth: 8,
            semi: false,
            printWidth: 80,
            bracketSpacing: true,
            singleQuote: true
        }),
        resolvePrinterLayoutDefaults: () => customLayoutDefaults,
        resolveSourceFormatter: () => noopSourceFormatter,
        resolveNormalizeFormattedOutput: () => noopNormalizer
    };
    const customComponents = createDefaultGmlFormatComponents(resolver);

    const provider = createDefaultGmlFormatProvider(resolver, customComponents);

    assert.strictEqual(
        resolveCalls,
        1,
        "factory should reuse the injected components instead of re-resolving adapters"
    );
    assert.strictEqual(provider.components, customComponents);
    assert.strictEqual(provider.prettierDefaults.tabWidth, 8);
    assert.strictEqual(provider.prettierDefaults.semi, false);
    assert.strictEqual(provider.formatSource, noopSourceFormatter);
    assert.strictEqual(provider.normalizeFormattedOutput, noopNormalizer);
    assert.ok(Object.isFrozen(provider), "factory output must remain frozen");
});

void test("createDefaultGmlFormatProvider with default resolver matches the module-level singleton", () => {
    const provider = createDefaultGmlFormatProvider();

    assert.deepStrictEqual(
        provider.components,
        defaultGmlFormatProvider.components,
        "default components bundle must deep-equal the module-level singleton"
    );
    assert.strictEqual(
        provider.prettierDefaults,
        defaultGmlFormatProvider.prettierDefaults,
        "default prettierDefaults must match the module-level singleton"
    );
    assert.strictEqual(
        provider.formatSource,
        defaultGmlFormatProvider.formatSource,
        "default formatSource must match the module-level singleton"
    );
    assert.strictEqual(
        provider.normalizeFormattedOutput,
        defaultGmlFormatProvider.normalizeFormattedOutput,
        "default normalizeFormattedOutput must match the module-level singleton"
    );
});
