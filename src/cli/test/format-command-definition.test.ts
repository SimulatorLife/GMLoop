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
