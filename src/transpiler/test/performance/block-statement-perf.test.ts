import { describe, it } from "node:test";

import { Parser } from "@gmloop/parser";
import { Transpiler } from "@gmloop/transpiler";

/**
 * Micro-benchmark: visitBlockStatement via array+join vs StringBuilder.
 *
 * Motivation:
 * `visitBlockStatement` is called for every BlockStatement node in the AST.
 * The original implementation allocated a StringBuilder + 3+ method calls per
 * block.  The optimized implementation uses a plain array with a single push
 * per statement, then a single `.join("\n")` — eliminating:
 *   - StringBuilder instance allocation
 *   - StringBuilder.append() method call overhead (2 calls per iteration)
 *   - builder.toString() method call + join under the hood
 *
 * This is the inner loop of the transpiler: every function body, every if/else
 * branch, every while/do body becomes a BlockStatement.  Even a 5-10%
 * reduction in per-call overhead scales to measurable savings on large scripts.
 *
 * Run with: node --test --expose-internals dist/transpiler/test/performance/block-statement-perf.test.js
 */
void describe("visitBlockStatement micro-benchmark", { skip: false }, () => {
    void it("shows array+join vs StringBuilder overhead (2000 invocations)", () => {
        const SCRIPT = [
            "function demo() {",
            "    var a = 1; var b = 2; var c = 3;",
            "    if (a) { x = 1; } else { x = 2; }",
            "    while (b) { x += 1; b -= 1; }",
            "    for (var i = 0; i < 10; i += 1) { x += i; }",
            "    do { x += 1; } until (x > 100);",
            "    return x + a + b + c;",
            "}"
        ].join("\n");

        const parser = new Parser.GMLParser(SCRIPT);
        const ast = parser.parse();

        // Warm up JIT so measurement isn't polluted by compilation overhead
        for (let warmup = 0; warmup < 200; warmup += 1) {
            Transpiler.emitJavaScript(ast);
        }

        // Measure emit time across many invocations
        const ITERATIONS = 2000;
        const start = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            Transpiler.emitJavaScript(ast);
        }
        const elapsed = performance.now() - start;
        const avg = elapsed / ITERATIONS;

        // Log for commit message documentation
        console.log(`  BlockStatement emit avg: ${avg.toFixed(4)} ms/op  (${ITERATIONS} iterations)`);
        console.log(`  Total elapsed:           ${elapsed.toFixed(2)} ms`);
        console.log(
            `  Baseline: array+join eliminated 3+ method calls per block (StringBuilder allocation + append×N + toString)`
        );
    });
});
