/**
 * Regression guard: the project-config catalog glue module
 * (`options/project-config-catalog.ts`) must not import concrete adapter
 * constants directly. The dependency-inversion seam is the dedicated
 * `components/printer-layout-defaults.ts` module, which re-exports the
 * printer's canonical `printWidth`/`tabWidth` values behind a stable
 * `GmlPrinterLayoutDefaults` contract.
 *
 * Why this guard exists
 * ---------------------
 * Before the seam, `options/project-config-catalog.ts` reached into
 * `../printer/constants.js` to obtain `DEFAULT_PRINT_WIDTH` and
 * `DEFAULT_TAB_WIDTH` for its `printWidth` and `tabWidth` catalog
 * entries. That coupling pulled a high-level orchestration module (the
 * project-config option catalog used by UI and documentation surfaces)
 * into a low-level adapter's constants file.
 *
 * The dependency-inversion seam is now
 * {@link DEFAULT_GML_PRINTER_LAYOUT_DEFAULTS} in
 * `components/printer-layout-defaults.ts`. The catalog is built via
 * {@link createProjectFormatOptionCatalog}, which consumes printer
 * layout defaults through the seam so the high-level glue stays free of
 * `../printer/` imports. This test asserts that the glue module
 * continues to depend on the seam abstraction instead of leaking
 * imports from the low-level adapter directory. If anyone re-adds a
 * direct `from "../printer/..."` import to `project-config-catalog.ts`,
 * the assertion fails so the cleanup can be re-applied.
 *
 * (target-state.md §2.3, §3.2 — orchestration depends on abstractions,
 * not concrete adapters.)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    createProjectFormatOptionCatalog,
    PROJECT_FORMAT_OPTION_CATALOG
} from "../src/options/project-config-catalog.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const CATALOG_MODULE_PATH = path.resolve(REPOSITORY_ROOT, "src/format/src/options/project-config-catalog.ts");

void test("project-config-catalog.ts does not import concrete printer constants directly", async () => {
    const source = await readFile(CATALOG_MODULE_PATH, "utf8");

    assert.doesNotMatch(
        source,
        /from\s+["']\.\.\/printer\//u,
        "project-config-catalog.ts must not import from ../printer/; the seam owns adapter selection"
    );
    assert.doesNotMatch(
        source,
        /from\s+["']\.\/printer\//u,
        "project-config-catalog.ts must not import from ./printer/; the seam owns adapter selection"
    );
});

void test("project-config-catalog.ts depends on the printer-layout-defaults seam", async () => {
    const source = await readFile(CATALOG_MODULE_PATH, "utf8");

    assert.match(
        source,
        /from\s+["']\.\.\/components\/printer-layout-defaults\.js["']/u,
        "project-config-catalog.ts must import the seam from ../components/printer-layout-defaults.js"
    );
    assert.match(
        source,
        /GmlPrinterLayoutDefaults/u,
        "project-config-catalog.ts must reference the GmlPrinterLayoutDefaults contract"
    );
    assert.match(
        source,
        /DEFAULT_GML_PRINTER_LAYOUT_DEFAULTS/u,
        "project-config-catalog.ts must reference the DEFAULT_GML_PRINTER_LAYOUT_DEFAULTS seam"
    );
});

void test("createProjectFormatOptionCatalog honours an injected layout defaults seam", () => {
    const customLayoutDefaults = Object.freeze({ printWidth: 77, tabWidth: 3, minVariablesBeforeLoopPadding: 5 });

    const catalog = createProjectFormatOptionCatalog(customLayoutDefaults);

    const printWidthEntry = catalog.find((entry) => entry.name === "printWidth");
    const tabWidthEntry = catalog.find((entry) => entry.name === "tabWidth");

    assert.ok(printWidthEntry, "catalog must include a printWidth entry");
    assert.ok(tabWidthEntry, "catalog must include a tabWidth entry");
    assert.strictEqual(printWidthEntry.defaultValue, 77, "injected printWidth must drive the catalog entry");
    assert.strictEqual(tabWidthEntry.defaultValue, 3, "injected tabWidth must drive the catalog entry");

    assert.notStrictEqual(
        catalog,
        PROJECT_FORMAT_OPTION_CATALOG,
        "injected catalog must be a fresh frozen array, not the module-level singleton"
    );
});

void test("createProjectFormatOptionCatalog returns a frozen array of frozen entries", () => {
    const catalog = createProjectFormatOptionCatalog();

    assert.ok(Object.isFrozen(catalog), "catalog array must be frozen");
    for (const entry of catalog) {
        assert.ok(Object.isFrozen(entry), "every catalog entry must be frozen");
    }
});

void test("module-level PROJECT_FORMAT_OPTION_CATALOG uses the default printer layout defaults", () => {
    const printWidthEntry = PROJECT_FORMAT_OPTION_CATALOG.find((entry) => entry.name === "printWidth");
    const tabWidthEntry = PROJECT_FORMAT_OPTION_CATALOG.find((entry) => entry.name === "tabWidth");

    assert.ok(printWidthEntry);
    assert.ok(tabWidthEntry);
    assert.strictEqual(typeof printWidthEntry.defaultValue, "number");
    assert.strictEqual(typeof tabWidthEntry.defaultValue, "number");
    assert.ok((printWidthEntry.defaultValue as number) > 0, "default printWidth must be a positive number");
    assert.ok((tabWidthEntry.defaultValue as number) > 0, "default tabWidth must be a positive number");
});
