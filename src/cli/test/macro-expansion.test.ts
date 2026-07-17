import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Parser } from "@gmloop/parser";
import type * as TranspilerTypes from "@gmloop/transpiler";
import { Transpiler } from "@gmloop/transpiler";

import { type TranspilationContext, transpileFile } from "../src/modules/transpilation/coordinator.js";

function createContext(
    macroDefinitions: ReturnType<typeof Transpiler.createProjectMacroDefinitions> = new Map(),
    macroDefinitionsBySourcePath?: TranspilerTypes.MacroDefinitionsBySourcePath
): TranspilationContext {
    const context: TranspilationContext = {
        transpiler: new Transpiler.GmlTranspiler(),
        patches: [],
        metrics: [],
        errors: [],
        lastSuccessfulPatches: new Map(),
        sourcePathToPatchIds: new Map(),
        bounds: { maxEntries: 50 },
        totalPatchCount: 0,
        websocketServer: null,
        macroDefinitions
    };

    if (macroDefinitionsBySourcePath) {
        context.macroDefinitionsBySourcePath = macroDefinitionsBySourcePath;
    }

    return context;
}

void describe("project macro expansion", () => {
    void it("preserves directive source values and supports cross-file chained macros", () => {
        const macroPath = "/project/scripts/constants.gml";
        const macroSource = `#macro BASE_VALUE 4
#macro ARRAY_VALUE [BASE_VALUE, 2]
#macro MESSAGE "hello world" // a trailing comment
`;
        const macroAst = new Parser.GMLParser(macroSource, {}).parse();
        const perFile = new Map([
            [macroPath, Transpiler.extractMacroDefinitionsFromAst(macroAst, macroPath, macroSource)]
        ]);
        const definitions = Transpiler.createProjectMacroDefinitions(perFile);

        assert.equal(definitions.get("BASE_VALUE")?.value, "4");
        assert.equal(definitions.get("ARRAY_VALUE")?.value, "[BASE_VALUE, 2]");
        assert.equal(definitions.get("MESSAGE")?.value, '"hello world" // a trailing comment');

        const targetPath = "/project/scripts/consumer.gml";
        const targetSource = `function consumer() {
    var values = ARRAY_VALUE;
    return values[BASE_VALUE - 4];
}`;
        const targetAst = new Parser.GMLParser(targetSource, {}).parse();
        const expanded = Transpiler.expandProjectMacros(targetAst, definitions, targetPath);

        assert.notStrictEqual(expanded, targetAst, "Expansion must not mutate the parser cache AST");
        const expandedText = JSON.stringify(expanded);
        assert.ok(expandedText.includes('"value":"4"'), "Chained macro values should be expanded");
        assert.ok(!expandedText.includes('"name":"ARRAY_VALUE"'), "Array macro references should be replaced");
    });

    void it("expands macros before split function patch emission", () => {
        const sourcePath = "/project/scripts/grouped.gml";
        const macroSource = "#macro SHARED_VALUE 4\n";
        const macroAst = new Parser.GMLParser(macroSource, {}).parse();
        const definitionsByPath = new Map([
            [
                "/project/scripts/constants.gml",
                Transpiler.extractMacroDefinitionsFromAst(macroAst, "/project/scripts/constants.gml", macroSource)
            ]
        ]);
        const context = createContext(Transpiler.createProjectMacroDefinitions(definitionsByPath), definitionsByPath);
        const source = `function first() {
    return SHARED_VALUE;
}

function second() {
    return SHARED_VALUE + 1;
}`;

        const result = transpileFile(context, sourcePath, `${macroSource}\n${source}`, 8, {
            verbose: false,
            quiet: true,
            deliverRuntimePatch: false
        });

        assert.equal(result.success, true);
        assert.equal(result.patches?.length, 2);
        assert.ok(result.patches?.every((patch) => !patch.js_body.includes("SHARED_VALUE")));
        assert.ok(result.patches?.some((patch) => patch.js_body.includes("return 4")));
        assert.ok(result.patches?.some((patch) => patch.js_body.includes("return 5")));
    });

    void it("reports cyclic macro definitions at transpilation time", () => {
        const sourcePath = "/project/scripts/cycle.gml";
        const source = `#macro FIRST SECOND
#macro SECOND FIRST
function cycle() {
    return FIRST;
}`;
        const ast = new Parser.GMLParser(source, {}).parse();
        const definitions = Transpiler.extractMacroDefinitionsFromAst(ast, sourcePath, source);

        assert.throws(
            () => Transpiler.expandProjectMacros(ast, definitions, sourcePath),
            /Cyclic macro expansion while transpiling.*FIRST.*SECOND.*FIRST/u
        );
    });

    void it("exposes macro definitions and uses as watch dependency symbols", () => {
        const definitionsByPath: TranspilerTypes.MacroDefinitionsBySourcePath = new Map();
        const context = createContext(new Map(), definitionsByPath);
        const macroPath = "/project/scripts/constants.gml";
        const macroSource = "#macro SHARED_VALUE 4\n";
        const macroResult = transpileFile(context, macroPath, macroSource, 2, {
            verbose: false,
            quiet: true,
            deliverRuntimePatch: false
        });

        assert.equal(macroResult.success, true);
        assert.deepEqual(macroResult.symbols, ["gml/macro/SHARED_VALUE"]);
        assert.deepEqual(macroResult.macroDefinitionChanges, ["gml/macro/SHARED_VALUE"]);

        const consumerResult = transpileFile(
            context,
            "/project/scripts/consumer.gml",
            "function consumer() { return SHARED_VALUE; }",
            1,
            { verbose: false, quiet: true, deliverRuntimePatch: false }
        );

        assert.equal(consumerResult.success, true);
        assert.deepEqual(consumerResult.references, ["gml/macro/SHARED_VALUE"]);
        assert.ok(consumerResult.patch?.js_body.includes("return 4"));
    });

    void it("reports a macro replacement change without changing its symbol name", () => {
        const definitionsByPath: TranspilerTypes.MacroDefinitionsBySourcePath = new Map();
        const context = createContext(new Map(), definitionsByPath);
        const macroPath = "/project/scripts/constants.gml";

        transpileFile(context, macroPath, "#macro SHARED_VALUE 4\n", 2, {
            verbose: false,
            quiet: true,
            deliverRuntimePatch: false
        });
        const result = transpileFile(context, macroPath, "#macro SHARED_VALUE 5\n", 2, {
            verbose: false,
            quiet: true,
            deliverRuntimePatch: false
        });

        assert.deepEqual(result.macroDefinitionChanges, ["gml/macro/SHARED_VALUE"]);
    });
});
