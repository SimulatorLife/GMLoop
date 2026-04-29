import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

void test("naming-convention codemod directory does not keep stray temporary artifacts", () => {
    const namingConventionDirectory = path.resolve(TEST_DIRECTORY, "../src/codemods/naming-convention");
    const temporaryArtifactPath = path.join(namingConventionDirectory, "rename.tmp");

    assert.equal(
        existsSync(temporaryArtifactPath),
        false,
        `Expected temporary artifact to be absent: ${temporaryArtifactPath}`
    );
});
