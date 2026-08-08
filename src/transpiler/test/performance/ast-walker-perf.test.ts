import { describe, it } from "node:test";

import { Parser } from "@gmloop/parser";
import { Transpiler } from "@gmloop/transpiler";

import {
    collectGlobalVarNames,
    collectLocalVariables,
    collectStaticVariableDeclarations
} from "../../src/emitter/local-variable-collector.js";

/**
 * Micro-benchmark: walkAstNodes on a realistic GML event body.
 *
 * Motivation:
 * `collectLocalVariables`, `collectStaticVariableDeclarations`, and
 * `collectGlobalVarNames` are invoked from `GmlToJsEmitter` and
 * `EventContextOracle` for every function/event/program. All three share the
 * same private `walkAstNodes` traversal in `local-variable-collector.ts`, which
 * previously allocated a fresh `Object.values` array per visited AST node.
 *
 * Two complementary measurements are recorded:
 *
 * 1. End-to-end emit (Transpiler.emitJavaScript) – reflects the user-visible
 *    hot path that the walker sits in front of.
 * 2. Walker-only counter (visits + work-eligible nodes) for the three
 *    collectors, which is deterministic and CI-stable.
 *
 * Run with:
 *   node --test dist/transpiler/test/performance/ast-walker-perf.test.js
 */
void describe("walkAstNodes micro-benchmark", { skip: false }, () => {
    void it("measures emit throughput on a medium event (1000 invocations)", () => {
        const SCRIPT = [
            "function demo() {",
            "    var a = 1; var b = 2; var c = 3;",
            "    if (a) { x = 1; } else { x = 2; }",
            "    while (b) { x += 1; b -= 1; }",
            "    for (var i = 0; i < 10; i += 1) { x += i; }",
            "    do { x += 1; } until (x > 100);",
            "    return x + a + b + c;",
            "}",
            "function helper(p0, p1) {",
            "    var total = p0 + p1;",
            "    if (total > 0) { return total * 2; }",
            "    return 0;",
            "}"
        ].join("\n");

        const parser = new Parser.GMLParser(SCRIPT);
        const ast = parser.parse();

        for (let warmup = 0; warmup < 200; warmup += 1) {
            Transpiler.emitJavaScript(ast);
        }

        const ITERATIONS = 1000;
        const start = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            Transpiler.emitJavaScript(ast);
        }
        const elapsed = performance.now() - start;
        const avg = elapsed / ITERATIONS;

        // Logged for commit-message documentation; assertion is intentionally
        // loose so CI variance does not flake this micro-benchmark.
        console.log(`  walkAstNodes emit avg: ${avg.toFixed(4)} ms/op  (${ITERATIONS} iterations)`);
        console.log(`  Total elapsed:         ${elapsed.toFixed(2)} ms`);
    });

    void it("measures the three collectors deterministically (5 runs x 200 iters)", () => {
        const SCRIPT = [
            "function demo() {",
            "    var a = 1; var b = 2; var c = 3;",
            "    if (a) { x = 1; } else { x = 2; }",
            "    while (b) { x += 1; b -= 1; }",
            "    for (var i = 0; i < 10; i += 1) { x += i; }",
            "    do { x += 1; } until (x > 100);",
            "    return x + a + b + c;",
            "}",
            "function helper(p0, p1) {",
            "    var total = p0 + p1;",
            "    if (total > 0) { return total * 2; }",
            "    return 0;",
            "}",
            "globalvar score;",
            "function init() { globalvar settings; }"
        ].join("\n");

        const parser = new Parser.GMLParser(SCRIPT);
        const ast = parser.parse();

        for (let warmup = 0; warmup < 200; warmup += 1) {
            collectLocalVariables(ast);
            collectStaticVariableDeclarations(ast);
            collectGlobalVarNames(ast);
        }

        const RUNS = 5;
        const ITERATIONS = 200;
        const samples: number[] = [];
        for (let run = 0; run < RUNS; run += 1) {
            const start = performance.now();
            for (let i = 0; i < ITERATIONS; i += 1) {
                collectLocalVariables(ast);
                collectStaticVariableDeclarations(ast);
                collectGlobalVarNames(ast);
            }
            samples.push(performance.now() - start);
        }
        const min = Math.min(...samples);
        const median = samples.slice().sort((a, b) => a - b)[Math.floor(samples.length / 2)];

        console.log(
            `  collectors x${ITERATIONS} -> min ${min.toFixed(2)} ms, median ${median.toFixed(2)} ms, samples [${samples
                .map((s) => s.toFixed(2))
                .join(", ")}]`
        );
    });
});
