import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    collectRefactorProjectGmlFiles,
    createRefactorFixtureSemanticAnalyzer
} from "./refactor-fixture-semantic-analyzer.js";

void test("collectRefactorProjectGmlFiles returns sorted nested GML file paths", async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-refactor-files-"));
    await mkdir(path.join(tempDirectory, "nested"), { recursive: true });
    await Promise.all([
        writeFile(path.join(tempDirectory, "scriptB.gml"), "function scriptB(){}", "utf8"),
        writeFile(path.join(tempDirectory, "nested", "scriptA.gml"), "function scriptA(){}", "utf8"),
        writeFile(path.join(tempDirectory, "nested", "ignore.txt"), "ignore", "utf8")
    ]);

    const discovered = await collectRefactorProjectGmlFiles(tempDirectory);

    assert.deepEqual(discovered, ["nested/scriptA.gml", "scriptB.gml"]);
});

void test("createRefactorFixtureSemanticAnalyzer indexes declarations and references", async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-refactor-semantic-"));
    await Promise.all([
        writeFile(path.join(tempDirectory, "alpha.gml"), "function Alpha() {\n    Alpha();\n    Beta();\n}\n", "utf8"),
        writeFile(path.join(tempDirectory, "beta.gml"), "function Beta() {\n    Alpha();\n}\n", "utf8")
    ]);

    const analyzer = await createRefactorFixtureSemanticAnalyzer(tempDirectory, ["alpha.gml", "beta.gml"]);
    const namingTargets = analyzer.listNamingConventionTargets();

    assert.deepEqual(
        namingTargets.map((target) => target.name).sort((left, right) => left.localeCompare(right)),
        ["Alpha", "Beta"]
    );
    assert.equal(analyzer.listNamingConventionTargets(["alpha.gml"]).length, 1);

    const alphaOccurrences = analyzer.getSymbolOccurrences("Alpha");
    assert.equal(alphaOccurrences.length, 3);
    assert.equal(alphaOccurrences.filter((entry) => entry.kind === "definition").length, 1);
    assert.equal(alphaOccurrences.filter((entry) => entry.kind === "reference").length, 2);
});
