/**
 * Verifies that GmlParserBridge and GmlTranspilerBridge implement the canonical
 * interfaces from @gmloop/refactor rather than local type duplicates.
 *
 * This is a compile-time/structural test: if the bridge classes ever diverge from
 * the canonical Refactor.ParserBridge or Refactor.TranspilerBridge interfaces, the
 * type assertions below will produce a TypeScript error that fails the build.
 *
 * Note: factories are passed explicitly here to exercise the injection path rather
 * than relying on defaults from bridge-dependencies (which may not be available in
 * all test environments). The bridge-factory.ts integration test covers the canonical
 * default-path wiring.
 */
import { describe, it } from "node:test";

import type * as Refactor from "@gmloop/refactor";

import { createGmlParserAdapter, createGmlTranspilerAdapter } from "../src/modules/refactor/bridge-dependencies.js";
import { GmlParserBridge } from "../src/modules/refactor/parser-bridge.js";
import { GmlTranspilerBridge } from "../src/modules/refactor/transpiler-bridge.js";

void describe("Bridge canonical type conformance", () => {
    void it("GmlParserBridge satisfies Refactor.ParserBridge", () => {
        // Compile-time assertion: fails build if GmlParserBridge no longer
        // implements the canonical Refactor.ParserBridge interface.
        const _: Refactor.ParserBridge = new GmlParserBridge(createGmlParserAdapter);
        void _;
    });

    void it("GmlTranspilerBridge satisfies Refactor.TranspilerBridge", () => {
        // Compile-time assertion: fails build if GmlTranspilerBridge no longer
        // implements the canonical Refactor.TranspilerBridge interface.
        const _: Refactor.TranspilerBridge = new GmlTranspilerBridge(createGmlTranspilerAdapter);
        void _;
    });
});
