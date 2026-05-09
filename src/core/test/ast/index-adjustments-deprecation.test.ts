/**
 * @file index-adjustments-deprecation.test.ts
 *
 * ## Purpose
 *
 * This test file verifies that the deprecated `applyIndexAdjustmentsIfPresent`
 * helper (previously in `src/core/src/ast/index-adjustments.ts`) has been removed
 * and is not re-introduced without deliberate review.
 *
 * The helper was removed because:
 *   1. It was never invoked by any consumer in the repository.
 *   2. Its double-indirection pattern (`applyAdjustments` callback) was inferior
 *      to the direct `remapLocationMetadata(mapIndex)` pattern already available.
 *   3. The lint workspace already implements a strict, type-safe equivalent:
 *      `applySanitizedIndexAdjustments` in conditional-assignment-sanitizer.ts.
 *
 * If a future requirement calls for this functionality, the pattern should be
 * demonstrated via a new unit test before the function is re-introduced. This
 * test prevents silent re-introduction of unused abstractions.
 *
 * ## Why this file exists
 *
 * The `index-adjustments.ts` module was deleted entirely because its only export
 * (`applyIndexAdjustmentsIfPresent`) was a dead abstraction with no callers. Keeping
 * even a documentation-only stub caused a lint violation (no-empty-file). Rather than
 * add eslint-disable directives, we deleted the stub and keep the context here in
 * the test file instead.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Core } from "../../index.js";

void test("applyIndexAdjustmentsIfPresent deprecation", (t) => {
    // Verify the function is not exported from Core
    void t.test("should NOT export applyIndexAdjustmentsIfPresent from Core", () => {
        const coreExports = Object.keys(Core);
        assert.ok(
            !coreExports.includes("applyIndexAdjustmentsIfPresent"),
            "applyIndexAdjustmentsIfPresent must not be exported from Core. " +
                "If this function is needed, demonstrate the use case with a consumer test first."
        );
    });
});
