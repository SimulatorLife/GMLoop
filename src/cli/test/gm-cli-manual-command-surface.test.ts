import assert from "node:assert/strict";
import test from "node:test";

import { getCliCommandCatalog } from "../src/cli.js";
import { CLI_COMMAND_NAMES } from "../src/shared/command-names.js";

void test("CLI command registry no longer exposes lookup-gml-identifier", () => {
    assert.equal(CLI_COMMAND_NAMES.has("lookup-gml-identifier"), false);
});

void test("CLI command catalog no longer advertises lookup-gml-identifier", () => {
    const commandCatalog = getCliCommandCatalog();

    assert.equal(
        commandCatalog.some((entry) => entry.displayName === "lookup-gml-identifier"),
        false
    );
});
