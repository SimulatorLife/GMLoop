import assert from "node:assert/strict";
import test from "node:test";

import { Refactor, type RefactorProjectAnalysisProvider } from "../index.js";
import type {
    FeatherRenamePlanner,
    GlobalVarRewriteAssessor,
    IdentifierOccupancyChecker,
    LoopHoistIdentifierResolver
} from "../src/types.js";

const { DEFAULT_PROJECT_ANALYSIS_PROVIDER } = Refactor;

/**
 * Validates that the RefactorProjectAnalysisProvider ISP split produces
 * structurally sound role-focused interfaces, that the composite extends
 * all of them, and that the default implementation can be assigned to
 * each role in isolation.
 */

void test("IdentifierOccupancyChecker is assignable from RefactorProjectAnalysisProvider", () => {
    const provider: RefactorProjectAnalysisProvider = DEFAULT_PROJECT_ANALYSIS_PROVIDER;
    const checker: IdentifierOccupancyChecker = provider;
    assert.strictEqual(typeof checker.isIdentifierOccupied, "function");
    assert.strictEqual(typeof checker.listIdentifierOccurrences, "function");
});

void test("FeatherRenamePlanner is assignable from RefactorProjectAnalysisProvider", () => {
    const provider: RefactorProjectAnalysisProvider = DEFAULT_PROJECT_ANALYSIS_PROVIDER;
    const planner: FeatherRenamePlanner = provider;
    assert.strictEqual(typeof planner.planFeatherRenames, "function");
});

void test("GlobalVarRewriteAssessor is assignable from RefactorProjectAnalysisProvider", () => {
    const provider: RefactorProjectAnalysisProvider = DEFAULT_PROJECT_ANALYSIS_PROVIDER;
    const assessor: GlobalVarRewriteAssessor = provider;
    assert.strictEqual(typeof assessor.assessGlobalVarRewrite, "function");
});

void test("LoopHoistIdentifierResolver is assignable from RefactorProjectAnalysisProvider", () => {
    const provider: RefactorProjectAnalysisProvider = DEFAULT_PROJECT_ANALYSIS_PROVIDER;
    const resolver: LoopHoistIdentifierResolver = provider;
    assert.strictEqual(typeof resolver.resolveLoopHoistIdentifier, "function");
});

void test("narrow role interfaces compose back to RefactorProjectAnalysisProvider", () => {
    const narrow = {} as IdentifierOccupancyChecker &
        FeatherRenamePlanner &
        GlobalVarRewriteAssessor &
        LoopHoistIdentifierResolver;
    const provider: RefactorProjectAnalysisProvider = narrow;
    assert.strictEqual(typeof provider, "object");
});

void test("IdentifierOccupancyChecker implementations only need the two overlap methods", async () => {
    const checker: IdentifierOccupancyChecker = {
        async isIdentifierOccupied(identifierName) {
            return identifierName === "taken";
        },
        async listIdentifierOccurrences(identifierName) {
            return identifierName === "taken" ? new Set(["/project/scripts/a.gml"]) : new Set();
        }
    };

    const context = {
        semantic: null,
        prepareRenamePlan: async () => {
            throw new Error("not used by this test double");
        }
    };

    assert.equal(await checker.isIdentifierOccupied("taken", context), true);
    assert.equal(await checker.isIdentifierOccupied("free", context), false);
    assert.deepEqual(await checker.listIdentifierOccurrences("taken", context), new Set(["/project/scripts/a.gml"]));
    assert.deepEqual(await checker.listIdentifierOccurrences("free", context), new Set());
});

void test("FeatherRenamePlanner implementations only need the planning method", async () => {
    const planner: FeatherRenamePlanner = {
        async planFeatherRenames(requests) {
            return requests.map((request) => ({
                identifierName: request.identifierName,
                mode: "local-fallback",
                preferredReplacementName: request.preferredReplacementName,
                replacementName: request.preferredReplacementName
            }));
        }
    };

    const context = {
        semantic: null,
        prepareRenamePlan: async () => {
            throw new Error("not used by this test double");
        }
    };
    const result = await planner.planFeatherRenames(
        [{ identifierName: "foo", preferredReplacementName: "bar" }],
        null,
        "/project",
        context
    );
    assert.deepEqual(result, [
        {
            identifierName: "foo",
            mode: "local-fallback",
            preferredReplacementName: "bar",
            replacementName: "bar"
        }
    ]);
});
