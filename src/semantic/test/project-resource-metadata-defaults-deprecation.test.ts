/**
 * @file project-resource-metadata-defaults-deprecation.test.ts
 *
 * ## Purpose
 *
 * This test file verifies that the `PROJECT_RESOURCE_METADATA_DEFAULTS`
 * compatibility alias (previously re-exported at the bottom of
 * `src/semantic/src/project-index/constants.ts`) has been removed and is not
 * re-introduced without deliberate review.
 *
 * The alias was removed because:
 *   1. It was a renamed re-export of the private `DEFAULT_RESOURCE_METADATA_EXTENSIONS`
 *      constant, exposing a private symbol under a public, longer-lived name.
 *   2. No call site in the repository imported the alias — it was pure
 *      backwards-compatibility surface area with no observed consumers.
 *   3. The canonical entry point for the default list is the
 *      `getProjectResourceMetadataExtensions()` accessor, which respects the
 *      same mutable `let` state that the alias bypassed.
 *
 * If a future requirement calls for this name to be exposed, demonstrate the
 * use case with a consumer test first, and prefer documenting the accessor
 * over reintroducing a renamed re-export of a private constant. This test
 * prevents silent reintroduction of the dead alias.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Semantic } from "../src/index.js";
import * as ProjectIndexConstants from "../src/project-index/constants.js";

void describe("PROJECT_RESOURCE_METADATA_DEFAULTS legacy alias removal", () => {
    void it("does not expose PROJECT_RESOURCE_METADATA_DEFAULTS from the project-index constants module", () => {
        assert.ok(
            !("PROJECT_RESOURCE_METADATA_DEFAULTS" in ProjectIndexConstants),
            "PROJECT_RESOURCE_METADATA_DEFAULTS must not be re-exported from " +
                "src/semantic/src/project-index/constants.ts. The canonical entry point " +
                "is getProjectResourceMetadataExtensions(). Reintroduce only with a " +
                "documented consumer test that motivates the alias."
        );
    });

    void it("does not expose PROJECT_RESOURCE_METADATA_DEFAULTS on the Semantic.ProjectIndex namespace", () => {
        assert.ok(
            !("PROJECT_RESOURCE_METADATA_DEFAULTS" in Semantic.ProjectIndex),
            "PROJECT_RESOURCE_METADATA_DEFAULTS must not be reachable via the public " +
                "Semantic.ProjectIndex namespace. The workspace should expose behavior, " +
                "not renamed re-exports of private constants."
        );
    });
});
