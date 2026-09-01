import assert from "node:assert/strict";
import { test } from "node:test";

import { createFormatCommand } from "../src/commands/format.js";

void test("createFormatCommand only targets .gml files and does not expose extension overrides", () => {
    const command = createFormatCommand();
    const hasExtensionsOption = command.options.some((option) => option.long === "--extensions");
    assert.equal(hasExtensionsOption, false);
});

void test("createFormatCommand help no longer documents extension overrides", () => {
    const command = createFormatCommand();

    const helpText = command.helpInformation();

    assert.doesNotMatch(helpText, /--extensions/);
});

void test("createFormatCommand does not expose the retired --ignored-directory-samples alias", () => {
    // The `--ignored-directory-samples` flag was a backwards-compatibility
    // alias for `--skipped-directory-sample-limit`. The alias has been
    // removed in favour of the canonical long-term flag; reintroducing the
    // hidden alias registration would silently re-introduce a shadowed
    // option name that diverges from the public CLI surface documented in
    // the help output above. (target-state.md §3.2 — no backwards-compat
    // shims; the canonical flag is the single source of truth.)
    const command = createFormatCommand();

    const hasAliasOption = command.options.some((option) => option.long === "--ignored-directory-samples");
    assert.equal(hasAliasOption, false);

    const helpText = command.helpInformation();
    assert.doesNotMatch(helpText, /--ignored-directory-samples/u);
});

void test("createFormatCommand does not expose the retired --ignored-directory-sample-limit flag", () => {
    // The `--ignored-directory-sample-limit` flag was a pre-rename spelling
    // of the canonical `--skipped-directory-sample-limit` flag. The legacy
    // spelling has been retired in favour of the canonical long-term flag;
    // reintroducing it would silently re-introduce a parallel path that
    // diverges from the public CLI surface documented in the help output
    // above. (target-state.md §3.2 — no backwards-compat shims; the
    // canonical flag is the single source of truth.)
    const command = createFormatCommand();

    const hasLegacyOption = command.options.some((option) => option.long === "--ignored-directory-sample-limit");
    assert.equal(hasLegacyOption, false);

    const helpText = command.helpInformation();
    assert.doesNotMatch(helpText, /--ignored-directory-sample-limit/u);
});

void test("createFormatCommand exposes the canonical --skipped-directory-sample-limit flag", () => {
    // The canonical option key reads `skippedDirectorySampleLimit` from the
    // Commander option bag, matching every internal helper and the
    // `skippedDirectorySummary` summary type. The CLI flag should use the
    // same `skipped-` prefix instead of the legacy `ignored-` spelling.
    const command = createFormatCommand();

    const hasCanonicalOption = command.options.some((option) => option.long === "--skipped-directory-sample-limit");
    assert.equal(hasCanonicalOption, true);

    const helpText = command.helpInformation();
    assert.match(helpText, /--skipped-directory-sample-limit/u);
});

void test("createFormatCommand exposes shared --list and --verbose options", () => {
    const command = createFormatCommand();

    assert.ok(command.options.some((option) => option.long === "--path"));
    assert.ok(command.options.some((option) => option.long === "--config"));
    assert.ok(command.options.some((option) => option.long === "--write"));
    assert.ok(command.options.some((option) => option.long === "--list"));
    assert.ok(command.options.some((option) => option.long === "--verbose"));
});

void test("createFormatCommand does not expose positional targetPath argument or --check option", () => {
    const command = createFormatCommand();

    assert.strictEqual(command.registeredArguments.length, 0);
    assert.ok(command.options.every((option) => option.long !== "--check"));
});
