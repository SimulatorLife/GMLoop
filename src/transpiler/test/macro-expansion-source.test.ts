import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractMacroDefinitionsFromSource } from "../src/macro-expansion.js";

void describe("source macro metadata", () => {
    void it("extracts macro and define directives without parsing unrelated source", () => {
        const definitions = extractMacroDefinitionsFromSource(
            String.raw`/* #macro ignored 0 */
#macro VALUE 42
#define alias(value) value + 1
#macro MULTILINE \
    VALUE
`,
            "/project/macros.gml"
        );

        assert.deepEqual(
            [...definitions.values()].map(({ name, parameters, value, sourcePath }) => ({
                name,
                parameters,
                value,
                sourcePath
            })),
            [
                { name: "VALUE", parameters: [], value: "42", sourcePath: "/project/macros.gml" },
                { name: "alias", parameters: ["value"], value: "value + 1", sourcePath: "/project/macros.gml" },
                { name: "MULTILINE", parameters: [], value: "VALUE", sourcePath: "/project/macros.gml" }
            ]
        );
    });
});
