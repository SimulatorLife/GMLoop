import assert from "node:assert/strict";
import test from "node:test";

import { gmlFormatComponents } from "../src/components/default-format-components.js";

void test("GML format component registry", async (t) => {
    await t.test("exposes validated defaults", () => {
        assert.ok(Object.isFrozen(gmlFormatComponents), "component bundle should be frozen");
        assert.ok(Object.isFrozen(gmlFormatComponents.parsers), "parsers map should be frozen");
        assert.ok(Object.isFrozen(gmlFormatComponents.printers), "printers map should be frozen");
        assert.ok(Object.isFrozen(gmlFormatComponents.options), "options map should be frozen");

        assert.ok(gmlFormatComponents.parsers["gml-parse"], "default parser should be registered");
        assert.ok(gmlFormatComponents.printers["gml-ast"], "default printer should be registered");
        assert.ok(
            Object.hasOwn(gmlFormatComponents.options, "logicalOperatorsStyle"),
            "logicalOperatorsStyle option should be registered"
        );
        assert.ok(
            Object.hasOwn(gmlFormatComponents.options, "allowInlineControlFlowBlocks"),
            "allowInlineControlFlowBlocks option should be registered"
        );
        assert.equal(Object.hasOwn(gmlFormatComponents.options, "optimizeLoopLengthHoisting"), false);
        assert.equal(Object.hasOwn(gmlFormatComponents.options, "applyFeatherFixes"), false);

        for (const removedOption of [
            "preserveLineBreaks",
            "maintainArrayIndentation",
            "maintainStructIndentation",
            "maintainWithIndentation",
            "maintainSwitchIndentation",
            // Stale name superseded by allowInlineControlFlowBlocks (applies to while/repeat/with too,
            // not just if statements). Guard against accidentally re-introducing the old key.
            "allowSingleLineIfStatements"
        ]) {
            assert.ok(
                !Object.hasOwn(gmlFormatComponents.options, removedOption),
                `${removedOption} should stay unregistered`
            );
        }
    });

    await t.test("components are immutable", () => {
        assert.throws(
            () => {
                (gmlFormatComponents.parsers as any)["modified-parser"] = {};
            },
            TypeError,
            "frozen parsers should reject new properties"
        );

        assert.throws(
            () => {
                (gmlFormatComponents.printers as any)["modified-printer"] = {};
            },
            TypeError,
            "frozen printers should reject new properties"
        );

        assert.throws(
            () => {
                (gmlFormatComponents.options as any)["modified-option"] = {};
            },
            TypeError,
            "frozen options should reject new properties"
        );
    });

    await t.test("component bundle is initialized at module load", () => {
        assert.ok(gmlFormatComponents, "component bundle should be available as module-level constant");
    });
});
