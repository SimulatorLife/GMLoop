/**
 * Regression guard: the format workspace's glue module
 * (`default-format-components.ts`) must not import concrete adapter
 * implementations directly. The dependency-inversion seam is the
 * `GmlFormatAdapterResolver` interface; concrete adapter selection lives
 * in `default-format-adapters.ts`.
 *
 * Why this guard exists
 * ---------------------
 * Before the resolver seam, `default-format-components.ts` reached into
 * `../parsers/`, `../printer/`, and `../comments/` to assemble the
 * default Prettier plugin bundle. That coupling pulled the
 * high-level orchestration layer into low-level adapter details and
 * made it hard to swap implementations (e.g. for tests or alternate
 * embedding contexts) without editing the glue module.
 *
 * The resolver interface in `default-format-adapters.ts` is now the
 * single dependency-inversion seam. This test asserts that the glue
 * module continues to depend on the seam instead of leaking imports
 * from low-level adapter directories. If anyone re-adds a direct
 * `from "../parsers/..."`, `from "../printer/..."`, or
 * `from "../comments/..."` import to `default-format-components.ts`,
 * the assertion fails so the cleanup can be re-applied.
 *
 * (target-state.md §2.3, §3.2 — orchestration depends on abstractions,
 * not concrete adapters.)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { handleComments, printComment } from "../src/comments/index.js";
import { defaultGmlFormatAdapterResolver } from "../src/components/default-format-adapters.js";
import {
    createDefaultGmlFormatComponents,
    defaultGmlFormatComponentImplementations
} from "../src/components/default-format-components.js";
import type { GmlFormatComponentContract } from "../src/components/format-types.js";
import { LogicalOperatorsStyle } from "../src/options/logical-operators-style.js";
import { gmlParserAdapter } from "../src/parsers/index.js";
import { print } from "../src/printer/index.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const GLUE_MODULE_PATH = path.resolve(REPOSITORY_ROOT, "src/format/src/components/default-format-components.ts");

void test("default-format-components.ts does not import concrete adapters directly", async () => {
    const source = await readFile(GLUE_MODULE_PATH, "utf8");

    assert.doesNotMatch(
        source,
        /from\s+["']\.\.\/parsers\//u,
        "default-format-components.ts must not import from ../parsers/; the resolver owns adapter selection"
    );
    assert.doesNotMatch(
        source,
        /from\s+["']\.\.\/printer\//u,
        "default-format-components.ts must not import from ../printer/; the resolver owns adapter selection"
    );
    assert.doesNotMatch(
        source,
        /from\s+["']\.\.\/comments\//u,
        "default-format-components.ts must not import from ../comments/; the resolver owns adapter selection"
    );
});

void test("default-format-components.ts depends on the resolver abstraction", async () => {
    const source = await readFile(GLUE_MODULE_PATH, "utf8");

    assert.match(
        source,
        /from\s+["']\.\/default-format-adapters\.js["']/u,
        "default-format-components.ts must import the resolver from ./default-format-adapters.js"
    );
    assert.match(
        source,
        /GmlFormatAdapterResolver/u,
        "default-format-components.ts must reference the GmlFormatAdapterResolver contract"
    );
});

void test("default bundle continues to resolve to the canonical adapters via the resolver", () => {
    assert.strictEqual(defaultGmlFormatComponentImplementations.gmlParserAdapter, gmlParserAdapter);
    assert.strictEqual(defaultGmlFormatComponentImplementations.print, print);
    assert.strictEqual(defaultGmlFormatComponentImplementations.printComment, printComment);
    assert.strictEqual(defaultGmlFormatComponentImplementations.handleComments, handleComments);
    assert.strictEqual(defaultGmlFormatComponentImplementations.LogicalOperatorsStyle, LogicalOperatorsStyle);

    assert.strictEqual(defaultGmlFormatAdapterResolver.resolveAdapters(), defaultGmlFormatComponentImplementations);
    assert.ok(Object.isFrozen(defaultGmlFormatAdapterResolver));
    assert.ok(Object.isFrozen(defaultGmlFormatComponentImplementations));
});

void test("createDefaultGmlFormatComponents honours an injected resolver", () => {
    let resolveCalls = 0;
    const customLogicalOperatorsStyle: GmlFormatComponentContract["LogicalOperatorsStyle"] = Object.freeze({
        KEYWORDS: "custom-keywords",
        SYMBOLS: "custom-symbols"
    });
    const noopNormalizer = (_formatted: string) => "noop";
    const customLayoutDefaults = Object.freeze({ printWidth: 100, tabWidth: 2 });
    const customCanAttachComment: GmlFormatComponentContract["canAttachComment"] = () => true;
    const customIsBlockComment: GmlFormatComponentContract["isBlockComment"] = () => false;
    const resolver = {
        resolveAdapters: () => {
            resolveCalls += 1;
            return {
                gmlParserAdapter,
                print,
                handleComments,
                printComment,
                canAttachComment: customCanAttachComment,
                isBlockComment: customIsBlockComment,
                LogicalOperatorsStyle: customLogicalOperatorsStyle
            } satisfies GmlFormatComponentContract;
        },
        resolvePrettierDefaults: () => ({
            tabWidth: 8,
            semi: false,
            printWidth: 80,
            bracketSpacing: true,
            singleQuote: true
        }),
        resolvePrinterLayoutDefaults: () => customLayoutDefaults,
        resolveNormalizeFormattedOutput: () => noopNormalizer
    };

    const components = createDefaultGmlFormatComponents(resolver);

    assert.strictEqual(resolveCalls, 1, "factory should consult the injected resolver exactly once");
    assert.strictEqual(components.parsers["gml-parse"], gmlParserAdapter);
    assert.strictEqual(components.printers["gml-ast"].print, print);
    assert.strictEqual(components.printers["gml-ast"].canAttachComment, customCanAttachComment);
    assert.strictEqual(components.printers["gml-ast"].isBlockComment, customIsBlockComment);

    const logicalOperatorsStyleOption = components.options.logicalOperatorsStyle as {
        default: unknown;
        choices: ReadonlyArray<{ value: unknown }>;
    };
    assert.strictEqual(
        logicalOperatorsStyleOption.default,
        customLogicalOperatorsStyle.KEYWORDS,
        "injected resolver must drive the logicalOperatorsStyle option defaults"
    );
    assert.deepStrictEqual(
        logicalOperatorsStyleOption.choices.map((choice) => choice.value),
        [customLogicalOperatorsStyle.KEYWORDS, customLogicalOperatorsStyle.SYMBOLS]
    );
});
