import assert from "node:assert/strict";
import test from "node:test";

import { Format } from "../src/index.js";

void test("useTabs indents GML with tabs", async () => {
    const source = "if (ready) {\n    if (active) {\n        run();\n    }\n}\n";

    const formatted = await Format.format(source, { tabWidth: 4, useTabs: true });

    assert.equal(formatted, "if (ready) {\n\tif (active) {\n\t\trun();\n\t}\n}\n");
});

void test("useTabs defaults to space indentation", async () => {
    const source = "if (ready) {\n\trun();\n}\n";

    const formatted = await Format.format(source, { tabWidth: 4, useTabs: false });

    assert.equal(formatted, "if (ready) {\n    run();\n}\n");
});
