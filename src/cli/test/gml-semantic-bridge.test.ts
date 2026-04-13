import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { Refactor } from "@gmloop/refactor";
import { Semantic } from "@gmloop/semantic";

import { collectImplicitInstanceVariableTargets } from "../src/modules/refactor/implicit-instance-variable-targets.js";
import { GmlSemanticBridge } from "../src/modules/refactor/semantic-bridge.js";

function findNthIndex(sourceText: string, searchText: string, occurrenceNumber: number): number {
    let searchIndex = -1;

    for (let occurrenceIndex = 0; occurrenceIndex < occurrenceNumber; occurrenceIndex += 1) {
        searchIndex = sourceText.indexOf(searchText, searchIndex + 1);
        if (searchIndex === -1) {
            throw new Error(`Could not find occurrence ${occurrenceNumber} of ${JSON.stringify(searchText)}`);
        }
    }

    return searchIndex;
}

void describe("GmlSemanticBridge tests", () => {
    void it("should find a symbol name in entry declarations even if entry name differs", () => {
        const mockProjectIndex = {
            identifiers: {
                scripts: {
                    "scope:script:scr_physics": {
                        identifierId: "gml/script/scr_physics",
                        name: "scr_physics",
                        declarations: [
                            {
                                name: "gravityFunction",
                                filePath: "scripts/scr_physics/scr_physics.gml",
                                start: { index: 100 },
                                end: { index: 115 }
                            }
                        ],
                        references: []
                    }
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");
        const occurrences = bridge.getSymbolOccurrences("gravityFunction");

        assert.strictEqual(occurrences.length, 1, "Should have found 1 occurrence of gravityFunction");
        assert.strictEqual(occurrences[0].path, "scripts/scr_physics/scr_physics.gml");
        assert.strictEqual(occurrences[0].kind, Refactor.OccurrenceKind.DEFINITION);
    });

    void it("should find references with matching targetName even if they are in unresolved entry", () => {
        const mockProjectIndex = {
            identifiers: {
                scripts: {
                    "scope:script:gravityFunction": {
                        identifierId: "gml/script/gravityFunction",
                        name: "gravityFunction",
                        declarations: [],
                        references: [
                            {
                                filePath: "objects/obj_player/Step_0.gml",
                                targetName: "gravityFunction",
                                start: { index: 50 },
                                end: { index: 65 }
                            }
                        ]
                    }
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");
        const occurrences = bridge.getSymbolOccurrences("gravityFunction");

        assert.strictEqual(occurrences.length, 1, "Should have found 1 reference to gravityFunction");
        assert.strictEqual(occurrences[0].path, "objects/obj_player/Step_0.gml");
        assert.strictEqual(occurrences[0].kind, Refactor.OccurrenceKind.REFERENCE);
    });

    void it("normalizes semantic end indexes to exclusive naming convention occurrences", async () => {
        const mockProjectIndex = {
            identifiers: {
                enumMembers: {
                    "enum-member:ECM-X": {
                        name: "X",
                        declarations: [
                            {
                                name: "X",
                                filePath: "scripts/ecm/ecm.gml",
                                start: { index: 20 },
                                end: { index: 21 }
                            }
                        ],
                        references: [
                            {
                                filePath: "scripts/ecm/ecm.gml",
                                start: { index: 40 },
                                end: { index: 41 }
                            }
                        ]
                    }
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");
        const targets = await bridge.listNamingConventionTargets();
        const xTarget = targets.find((target) => target.category === "enumMember" && target.name === "X");

        assert.ok(xTarget, "Expected X enum member target");
        assert.strictEqual(xTarget?.occurrences?.[0]?.start, 20);
        assert.strictEqual(xTarget?.occurrences?.[0]?.end, 22);
        assert.strictEqual(xTarget?.occurrences?.[1]?.start, 40);
        assert.strictEqual(xTarget?.occurrences?.[1]?.end, 42);
    });

    void it("listNamingConventionTargets does not treat enum-member references as local variable occurrences", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-local-occurrences-"));
        const sourceText = "function demo(X) {\n    var collider = array_create(CM.X);\n    return X;\n}\n";
        const relativeFilePath = "scripts/demo/demo.gml";
        fs.mkdirSync(path.join(tmpRoot, "scripts", "demo"), { recursive: true });
        fs.writeFileSync(path.join(tmpRoot, relativeFilePath), sourceText, "utf8");
        const parameterStart = sourceText.indexOf("X)");
        const enumMemberReferenceStart = sourceText.indexOf("CM.X") + "CM.".length;
        const localReferenceStart = sourceText.lastIndexOf("X;");
        const mockProjectIndex = {
            files: {
                [relativeFilePath]: {
                    declarations: [
                        {
                            name: "X",
                            scopeId: "scope:function",
                            classifications: ["parameter"],
                            start: { index: parameterStart },
                            end: { index: parameterStart }
                        }
                    ],
                    references: [
                        {
                            name: "X",
                            scopeId: "scope:function",
                            classifications: ["enum-member"],
                            start: { index: enumMemberReferenceStart },
                            end: { index: enumMemberReferenceStart },
                            declaration: {
                                name: "X",
                                scopeId: "scope:function",
                                start: { index: parameterStart }
                            }
                        },
                        {
                            name: "X",
                            scopeId: "scope:function",
                            classifications: ["parameter"],
                            start: { index: localReferenceStart },
                            end: { index: localReferenceStart },
                            declaration: {
                                name: "X",
                                scopeId: "scope:function",
                                start: { index: parameterStart }
                            }
                        }
                    ]
                }
            },
            scopes: {
                "scope:function": {
                    kind: "function"
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const targets = await bridge.listNamingConventionTargets();
        const argumentTarget = targets.find((target) => target.category === "argument" && target.name === "X");

        assert.ok(argumentTarget, "Expected X argument target");
        assert.equal(argumentTarget?.occurrences.length, 2);
        assert.deepEqual(
            argumentTarget?.occurrences.map((occurrence) => occurrence.start),
            [parameterStart, localReferenceStart]
        );
    });

    void it("findSymbolOccurrences fallback on disk should skip string literals and partial identifiers", () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-fallback-"));
        const gmlPath = "scripts/switch_case.gml";
        fs.mkdirSync(path.join(tmpRoot, "scripts"), { recursive: true });

        const sourceText = [
            "var x = 1;",
            "var x_num = 2;",
            "var y = x;",
            "switch (y) {",
            "    case x:",
            "    case x_num:",
            '    case "x":',
            "    default:",
            "        break;",
            "}",
            ""
        ].join("\n");

        fs.writeFileSync(path.join(tmpRoot, gmlPath), sourceText, "utf8");

        const mockProjectIndex = {
            resources: {
                [gmlPath]: {
                    name: "x",
                    path: gmlPath,
                    resourceType: "GMScript"
                }
            },
            files: {
                [gmlPath]: {}
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const occurrences = bridge.getSymbolOccurrences("x", "gml/scripts/x");

        assert.strictEqual(occurrences.length, 3, "Should match only the x identifier occurrences");
        assert.ok(!occurrences.some((hit) => hit.start === sourceText.indexOf("x_num")));
        assert.ok(!occurrences.some((hit) => hit.start === sourceText.indexOf('"x"')));
    });

    void it("findSymbolOccurrences fallback should not match a quoted string-only symbol", () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-fallback2-"));
        const gmlPath = "scripts/switch_literal.gml";
        fs.mkdirSync(path.join(tmpRoot, "scripts"), { recursive: true });

        const sourceText = [
            "switch (token)",
            '    case "v":',
            '    case "vn":',
            '    case "vt":',
            "    default:",
            "        break;",
            ""
        ].join("\n");

        fs.writeFileSync(path.join(tmpRoot, gmlPath), sourceText, "utf8");

        const mockProjectIndex = {
            resources: {
                [gmlPath]: {
                    name: "v",
                    path: gmlPath,
                    resourceType: "GMScript"
                }
            },
            files: {
                [gmlPath]: {}
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const occurrences = bridge.getSymbolOccurrences("v", "gml/scripts/v");

        assert.strictEqual(
            occurrences.length,
            0,
            "Should not rename case string literals when there are no identifiers"
        );
    });

    void it("getSymbolOccurrences includes constructor runtime type checks for coupled single-callable scripts", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-constructor-runtime-type-"));

        try {
            fs.mkdirSync(path.join(tmpRoot, "scripts", "__input_class_binding"), { recursive: true });
            fs.mkdirSync(path.join(tmpRoot, "scripts", "input_value_is_binding"), { recursive: true });
            fs.writeFileSync(
                path.join(tmpRoot, "MyGame.yyp"),
                `${JSON.stringify(
                    {
                        name: "MyGame",
                        resourceType: "GMProject",
                        resources: [
                            {
                                id: {
                                    name: "__input_class_binding",
                                    path: "scripts/__input_class_binding/__input_class_binding.yy"
                                }
                            },
                            {
                                id: {
                                    name: "input_value_is_binding",
                                    path: "scripts/input_value_is_binding/input_value_is_binding.yy"
                                }
                            }
                        ]
                    },
                    null,
                    2
                )}\n`
            );
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "__input_class_binding", "__input_class_binding.yy"),
                `${JSON.stringify(
                    {
                        name: "__input_class_binding",
                        resourceType: "GMScript",
                        resourcePath: "scripts/__input_class_binding/__input_class_binding.yy"
                    },
                    null,
                    2
                )}\n`
            );
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "__input_class_binding", "__input_class_binding.gml"),
                "function __input_class_binding() constructor {}\n"
            );
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "input_value_is_binding", "input_value_is_binding.yy"),
                `${JSON.stringify(
                    {
                        name: "input_value_is_binding",
                        resourceType: "GMScript",
                        resourcePath: "scripts/input_value_is_binding/input_value_is_binding.yy"
                    },
                    null,
                    2
                )}\n`
            );
            const consumerSource = [
                "function input_value_is_binding(_value) {",
                "    return is_instanceof(_value, __input_class_binding);",
                "}",
                "",
                "function input_value_is_binding_legacy(_value) {",
                '    return instanceof(_value) == "__input_class_binding";',
                "}",
                ""
            ].join("\n");
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "input_value_is_binding", "input_value_is_binding.gml"),
                consumerSource
            );

            const projectIndex = await Semantic.buildProjectIndex(tmpRoot);
            const bridge = new GmlSemanticBridge(projectIndex, tmpRoot);
            const occurrences = bridge.getSymbolOccurrences(
                "__input_class_binding",
                "gml/scripts/__input_class_binding"
            );
            const bareTypeReferenceStart = findNthIndex(consumerSource, "__input_class_binding", 1);
            const stringTypeReferenceStart = findNthIndex(consumerSource, "__input_class_binding", 2);

            assert.ok(
                occurrences.some(
                    (occurrence) =>
                        occurrence.path === "scripts/input_value_is_binding/input_value_is_binding.gml" &&
                        occurrence.start === bareTypeReferenceStart &&
                        occurrence.end === bareTypeReferenceStart + "__input_class_binding".length &&
                        occurrence.kind === Refactor.OccurrenceKind.REFERENCE
                ),
                "expected is_instanceof constructor reference to be reported as an occurrence"
            );
            assert.ok(
                occurrences.some(
                    (occurrence) =>
                        occurrence.path === "scripts/input_value_is_binding/input_value_is_binding.gml" &&
                        occurrence.start === stringTypeReferenceStart &&
                        occurrence.end === stringTypeReferenceStart + "__input_class_binding".length &&
                        occurrence.kind === Refactor.OccurrenceKind.REFERENCE
                ),
                "expected instanceof string comparison to be reported as an occurrence"
            );
        } finally {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    void it("ignores relationship-based script call occurrences when the project index omits call spans", () => {
        const sourceText = "function consumer_script() {\n    return demo_script();\n}\n";
        const mockProjectIndex = {
            relationships: {
                scriptCalls: [
                    {
                        from: {
                            filePath: "scripts/consumer_script/consumer_script.gml",
                            scopeId: "scope:consumer"
                        },
                        target: {
                            name: "demo_script"
                        }
                    }
                ]
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");
        const occurrences = bridge.getSymbolOccurrences("demo_script");

        assert.deepEqual(
            occurrences,
            [],
            "Relationship fallback should skip unresolved spans instead of synthesizing a zero-length edit"
        );
        assert.strictEqual(findNthIndex(sourceText, "demo_script", 1), 40);
    });

    void it("ignores entry references when the project index omits their source span", () => {
        const mockProjectIndex = {
            identifiers: {
                scripts: {
                    consumer_script: {
                        identifierId: "gml/script/consumer_script",
                        name: "consumer_script",
                        declarations: [],
                        references: [
                            {
                                filePath: "scripts/consumer_script/consumer_script.gml",
                                targetName: "demo_script"
                            }
                        ]
                    }
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");

        assert.deepEqual(
            bridge.getSymbolOccurrences("demo_script"),
            [],
            "Missing reference spans should not produce zero-length edits at the start of the file"
        );
    });

    void it("hasSymbol should find a nested function symbol", () => {
        const mockProjectIndex = {
            identifiers: {
                scripts: {
                    "scope:script:scr_physics": {
                        identifierId: "gml/script/scr_physics",
                        name: "scr_physics",
                        declarations: [
                            {
                                name: "gravityFunction",
                                filePath: "scripts/scr_physics/scr_physics.gml",
                                start: { index: 100 },
                                end: { index: 115 }
                            }
                        ],
                        references: []
                    }
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");
        const exists = bridge.hasSymbol("gml/script/gravityFunction");
        assert.ok(exists, "Should have found gravityFunction via hasSymbol");
    });

    void it("hasSymbol should match SCIP-style ID to internal indexer ID", () => {
        const mockProjectIndex = {
            identifiers: {
                macros: {
                    MY_MACRO: {
                        identifierId: "macro:MY_MACRO",
                        name: "MY_MACRO",
                        declarations: [{ filePath: "f1.gml", start: { index: 0 }, end: { index: 0 } }]
                    }
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");
        assert.ok(bridge.hasSymbol("gml/macro/MY_MACRO"), "Should find macro via SCIP ID");
    });

    void it("resolveSymbolId should correctly infer kinds", () => {
        const mockProjectIndex = {
            identifiers: {
                scripts: {
                    "scope:script:func": { identifierId: "script:func", name: "func", declarations: [] }
                },
                macros: {
                    MAC: { identifierId: "macro:MAC", name: "MAC", declarations: [] }
                },
                globalVariables: {
                    glob: { identifierId: "global:glob", name: "glob", declarations: [] }
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");
        assert.strictEqual(bridge.resolveSymbolId("func"), "gml/script/func");
        assert.strictEqual(bridge.resolveSymbolId("MAC"), "gml/macro/MAC");
        assert.strictEqual(bridge.resolveSymbolId("glob"), "gml/var/glob");
    });

    void it("should handle missing identifiers property by falling back to identifierCollections", () => {
        // Simulate a ProjectIndex where 'identifiers' is missing but 'identifierCollections' is present
        const mockProjectIndex = {
            // No identifiers property
            identifierCollections: {
                scripts: {
                    "scope:script:func": { identifierId: "script:func", name: "func", declarations: [] }
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");
        assert.strictEqual(bridge.resolveSymbolId("func"), "gml/script/func");
        assert.ok(bridge.hasSymbol("gml/script/func"));
    });
    void it("resolveSymbolId should match case-insensitively", () => {
        const mockProjectIndex = {
            identifiers: {
                scripts: {
                    "scope:script:GravityFunction": {
                        identifierId: "script:GravityFunction",
                        name: "GravityFunction",
                        declarations: []
                    }
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");
        // User types "gravityFunction" (lowercase), index has "GravityFunction"
        assert.strictEqual(bridge.resolveSymbolId("gravityFunction"), "gml/script/GravityFunction");
    });

    void it("hasSymbol should find an object resource in the resources map", () => {
        const mockProjectIndex = {
            identifiers: {},
            resources: {
                "objects/oGravitySphere/oGravitySphere.yy": {
                    path: "objects/oGravitySphere/oGravitySphere.yy",
                    name: "oGravitySphere",
                    resourceType: "GMObject",
                    assetReferences: []
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");
        assert.ok(bridge.hasSymbol("gml/objects/oGravitySphere"), "Should find object resource via hasSymbol");

        // Also test case insensitivity
        assert.ok(bridge.hasSymbol("gml/objects/ogravitysphere"), "Should find object resource case-insensitively");
    });

    void it("getSymbolOccurrences supplements resource declarations with scanned GML references", () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-resource-occurrences-"));
        const resourcePath = "objects/oCamera/oCamera.yy";
        const eventPath = "objects/oSystem/Other_2.gml";
        const eventSource = "instance_create_depth(0, 0, 0, oCamera);\n";

        fs.mkdirSync(path.join(tmpRoot, "objects", "oSystem"), { recursive: true });
        fs.writeFileSync(path.join(tmpRoot, eventPath), eventSource, "utf8");

        const mockProjectIndex = {
            identifiers: {},
            resources: {
                [resourcePath]: {
                    path: resourcePath,
                    name: "oCamera",
                    resourceType: "GMObject",
                    assetReferences: []
                }
            },
            files: {
                [eventPath]: {
                    references: [
                        {
                            name: "oCamera",
                            start: { index: eventSource.indexOf("oCamera") },
                            end: { index: eventSource.indexOf("oCamera") + "oCamera".length - 1 },
                            scopeId: "scope:object:oSystem",
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const occurrences = bridge.getSymbolOccurrences("oCamera", "gml/objects/oCamera");

        assert.ok(occurrences.some((occurrence) => occurrence.path === resourcePath));
        assert.ok(occurrences.some((occurrence) => occurrence.path === eventPath));
    });

    void it("getAdditionalSymbolEdits rewrites yy metadata using structured updates", () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-"));
        const resourcePath = "objects/oGravitySphere/oGravitySphere.yy";
        const refPath = "objects/oRef/oRef.yy";
        const projectManifestPath = "project.yyp";

        const resourceAbsolute = path.join(tmpRoot, resourcePath);
        const refAbsolute = path.join(tmpRoot, refPath);
        const projectManifestAbsolute = path.join(tmpRoot, projectManifestPath);
        fs.mkdirSync(path.dirname(resourceAbsolute), { recursive: true });
        fs.mkdirSync(path.dirname(refAbsolute), { recursive: true });

        fs.writeFileSync(
            resourceAbsolute,
            `{"%Name":"oGravitySphere","name":"oGravitySphere","resourceType":"GMObject","resourcePath":"objects/oGravitySphere/oGravitySphere.yy",}`,
            "utf8"
        );
        fs.writeFileSync(
            refAbsolute,
            `{"name":"oRef","resourceType":"GMObject","spriteId":{"%Name":"oGravitySphere","name":"oGravitySphere","path":"objects/oGravitySphere/oGravitySphere.yy",}}`,
            "utf8"
        );
        fs.writeFileSync(
            projectManifestAbsolute,
            `{
                "name":"MyGame",
                "resourceType":"GMProject",
                "resources":[{"id":{"%Name":"oGravitySphere","name":"oGravitySphere","path":"objects/oGravitySphere/oGravitySphere.yy",}}],
            }`,
            "utf8"
        );

        const mockProjectIndex = {
            identifiers: {},
            resources: {
                [resourcePath]: {
                    path: resourcePath,
                    name: "oGravitySphere",
                    resourceType: "GMObject",
                    assetReferences: []
                },
                [refPath]: {
                    path: refPath,
                    name: "oRef",
                    resourceType: "GMObject",
                    assetReferences: [
                        {
                            propertyPath: "spriteId",
                            targetPath: resourcePath,
                            targetName: "oGravitySphere"
                        }
                    ]
                },
                [projectManifestPath]: {
                    path: projectManifestPath,
                    name: "MyGame",
                    resourceType: "GMProject",
                    assetReferences: [
                        {
                            propertyPath: "resources.0.id",
                            targetPath: resourcePath,
                            targetName: "oGravitySphere"
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const edits = bridge.getAdditionalSymbolEdits("gml/objects/oGravitySphere", "oGravityWell");

        assert.ok(edits, "Expected additional edits for resource rename");
        assert.ok(edits.metadataEdits.some((entry) => entry.path === resourcePath));
        assert.ok(edits.metadataEdits.some((entry) => entry.path === refPath));
        assert.ok(edits.metadataEdits.some((entry) => entry.path === projectManifestPath));

        const referenceEdit = edits.metadataEdits.find((entry) => entry.path === refPath);
        assert.ok(referenceEdit);
        assert.match(referenceEdit.content, /"name"\s*:\s*"oGravityWell"/);
        assert.match(referenceEdit.content, /"path"\s*:\s*"objects\/oGravityWell\/oGravityWell\.yy"/);

        const manifestEdit = edits.metadataEdits.find((entry) => entry.path === projectManifestPath);
        assert.ok(manifestEdit);
        assert.match(manifestEdit.content, /"name"\s*:\s*"oGravityWell"/);
        assert.match(manifestEdit.content, /"path"\s*:\s*"objects\/oGravityWell\/oGravityWell\.yy"/);
    });

    void it("getAdditionalSymbolEdits updates resourcePath in the renamed resource file", () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-resourcepath-"));
        const resourcePath = "objects/oGravitySphere/oGravitySphere.yy";
        const projectManifestPath = "project.yyp";

        const resourceAbsolute = path.join(tmpRoot, resourcePath);
        const projectManifestAbsolute = path.join(tmpRoot, projectManifestPath);
        fs.mkdirSync(path.dirname(resourceAbsolute), { recursive: true });

        fs.writeFileSync(
            resourceAbsolute,
            `{"%Name":"oGravitySphere","name":"oGravitySphere","resourceType":"GMObject","resourcePath":"objects/oGravitySphere/oGravitySphere.yy",}`,
            "utf8"
        );
        fs.writeFileSync(
            projectManifestAbsolute,
            `{
                "name":"MyGame",
                "resourceType":"GMProject",
                "resources":[{"id":{"%Name":"oGravitySphere","name":"oGravitySphere","path":"objects/oGravitySphere/oGravitySphere.yy",}}],
            }`,
            "utf8"
        );

        const mockProjectIndex = {
            identifiers: {},
            resources: {
                [resourcePath]: {
                    path: resourcePath,
                    name: "oGravitySphere",
                    resourceType: "GMObject",
                    assetReferences: []
                },
                [projectManifestPath]: {
                    path: projectManifestPath,
                    name: "MyGame",
                    resourceType: "GMProject",
                    assetReferences: [
                        {
                            propertyPath: "resources.0.id",
                            targetPath: resourcePath,
                            targetName: "oGravitySphere"
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const edits = bridge.getAdditionalSymbolEdits("gml/objects/oGravitySphere", "oGravityWell");

        assert.ok(edits, "Expected additional edits for resource rename");

        const resourceEdit = edits.metadataEdits.find((entry) => entry.path === resourcePath);
        assert.ok(resourceEdit);
        assert.match(resourceEdit.content, /"name"\s*:\s*"oGravityWell"/);
        assert.match(resourceEdit.content, /"resourcePath"\s*:\s*"objects\/oGravityWell\/oGravityWell\.yy"/);
    });

    void it("getAdditionalSymbolEdits skips directory rename when destination folder already exists", () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-bridge-existing-dest-"));
        const sourceResourcePath = "objects/oGravitySphere/oGravitySphere.yy";
        const destinationResourcePath = "objects/oGravityWell/oGravityWell.yy";
        const projectManifestPath = "project.yyp";

        const sourceResourceAbsolute = path.join(tmpRoot, sourceResourcePath);
        const destinationResourceAbsolute = path.join(tmpRoot, destinationResourcePath);
        const destinationMarkerAbsolute = path.join(tmpRoot, "objects/oGravityWell/keep.txt");
        const projectManifestAbsolute = path.join(tmpRoot, projectManifestPath);
        fs.mkdirSync(path.dirname(sourceResourceAbsolute), { recursive: true });
        fs.mkdirSync(path.dirname(destinationResourceAbsolute), { recursive: true });

        fs.writeFileSync(
            sourceResourceAbsolute,
            `{"name":"oGravitySphere","resourceType":"GMObject","resourcePath":"objects/oGravitySphere/oGravitySphere.yy",}`,
            "utf8"
        );
        fs.writeFileSync(destinationMarkerAbsolute, "existing directory marker", "utf8");
        fs.writeFileSync(
            projectManifestAbsolute,
            `{
                "name":"MyGame",
                "resourceType":"GMProject",
                "resources":[{"id":{"name":"oGravitySphere","path":"objects/oGravitySphere/oGravitySphere.yy",}}],
            }`,
            "utf8"
        );

        const mockProjectIndex = {
            identifiers: {},
            resources: {
                [sourceResourcePath]: {
                    path: sourceResourcePath,
                    name: "oGravitySphere",
                    resourceType: "GMObject",
                    assetReferences: []
                },
                [projectManifestPath]: {
                    path: projectManifestPath,
                    name: "MyGame",
                    resourceType: "GMProject",
                    assetReferences: [
                        {
                            propertyPath: "resources.0.id",
                            targetPath: sourceResourcePath,
                            targetName: "oGravitySphere"
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const edits = bridge.getAdditionalSymbolEdits("gml/objects/oGravitySphere", "oGravityWell");

        assert.ok(edits, "Expected additional edits for resource rename");
        assert.ok(fs.existsSync(destinationMarkerAbsolute), "Expected pre-existing destination directory content");
        assert.deepEqual(edits.fileRenames, [
            {
                oldPath: sourceResourcePath,
                newPath: destinationResourcePath
            }
        ]);
        assert.ok(
            edits.fileRenames.every((rename) => rename.oldPath !== "objects/oGravitySphere"),
            "Expected no directory-level rename when destination directory already exists"
        );
    });

    void it("getAdditionalSymbolEdits updates sprite keyframe self-reference paths without mutating keyframe UUID names", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-sprite-keyframe-id-"));
        const spritePath = "sprites/sArm/sArm.yy";
        const manifestPath = "MyGame.yyp";
        const spriteAbsolute = path.join(tmpRoot, spritePath);
        const manifestAbsolute = path.join(tmpRoot, manifestPath);
        fs.mkdirSync(path.dirname(spriteAbsolute), { recursive: true });

        try {
            fs.writeFileSync(
                spriteAbsolute,
                JSON.stringify(
                    {
                        "%Name": "sArm",
                        name: "sArm",
                        resourceType: "GMSprite",
                        resourcePath: spritePath,
                        sequence: {
                            tracks: [
                                {
                                    keyframes: {
                                        Keyframes: [
                                            {
                                                Channels: {
                                                    "0": {
                                                        Id: {
                                                            name: "39cfd82d-bb0b-4447-a5ee-669873fd3d89",
                                                            path: spritePath
                                                        }
                                                    }
                                                }
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    },
                    null,
                    2
                ),
                "utf8"
            );
            fs.writeFileSync(
                manifestAbsolute,
                `${JSON.stringify(
                    {
                        name: "MyGame",
                        resourceType: "GMProject",
                        resources: [{ id: { name: "sArm", path: spritePath } }]
                    },
                    null,
                    2
                )}\n`,
                "utf8"
            );

            const projectIndex = await Semantic.buildProjectIndex(tmpRoot);
            const bridge = new GmlSemanticBridge(projectIndex, tmpRoot);
            const edits = bridge.getAdditionalSymbolEdits("gml/sprites/sArm", "spr_arm");

            assert.ok(edits, "Expected additional edits for sprite resource rename");

            const spriteEdit = edits.metadataEdits.find((entry) => entry.path === spritePath);
            assert.ok(spriteEdit);
            assert.match(spriteEdit.content, /"resourcePath"\s*:\s*"sprites\/spr_arm\/spr_arm\.yy"/);
            assert.match(spriteEdit.content, /"path"\s*:\s*"sprites\/spr_arm\/spr_arm\.yy"/);
            assert.match(spriteEdit.content, /"name"\s*:\s*"39cfd82d-bb0b-4447-a5ee-669873fd3d89"/);
            assert.doesNotMatch(spriteEdit.content, /"Id"\s*:\s*\{\s*"name"\s*:\s*"spr_arm"/);

            const manifestEdit = edits.metadataEdits.find((entry) => entry.path === manifestPath);
            assert.ok(manifestEdit);
            assert.match(manifestEdit.content, /"name"\s*:\s*"spr_arm"/);
            assert.match(manifestEdit.content, /"path"\s*:\s*"sprites\/spr_arm\/spr_arm\.yy"/);
        } finally {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    void it("getAdditionalSymbolEdits keeps InterplanetaryFootball.resource_order aligned across staged resource renames", () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-resource-order-"));
        const projectRoot = path.join(tmpRoot, "InterplanetaryFootball");
        const objectPath = "objects/oCamera/oCamera.yy";
        const scriptPath = "scripts/AssetLoader/AssetLoader.yy";
        const resourceOrderPath = "InterplanetaryFootball.resource_order";

        const objectAbsolute = path.join(projectRoot, objectPath);
        const scriptAbsolute = path.join(projectRoot, scriptPath);
        const resourceOrderAbsolute = path.join(projectRoot, resourceOrderPath);
        fs.mkdirSync(path.dirname(objectAbsolute), { recursive: true });
        fs.mkdirSync(path.dirname(scriptAbsolute), { recursive: true });

        fs.writeFileSync(
            objectAbsolute,
            `{"name":"oCamera","resourceType":"GMObject","resourcePath":"objects/oCamera/oCamera.yy",}`,
            "utf8"
        );
        fs.writeFileSync(
            scriptAbsolute,
            `{"name":"AssetLoader","resourceType":"GMScript","resourcePath":"scripts/AssetLoader/AssetLoader.yy",}`,
            "utf8"
        );
        fs.writeFileSync(
            resourceOrderAbsolute,
            JSON.stringify(
                {
                    FolderOrderSettings: [],
                    ResourceOrderSettings: [
                        {
                            name: "oCamera",
                            order: 4,
                            path: "objects/oCamera/oCamera.yy"
                        },
                        {
                            name: "AssetLoader",
                            order: 1,
                            path: "scripts/AssetLoader/AssetLoader.yy"
                        },
                        {
                            name: "oGoal",
                            order: 2,
                            path: "objects/oGoal/oGoal.yy"
                        }
                    ]
                },
                null,
                2
            ),
            "utf8"
        );

        const mockProjectIndex = {
            identifiers: {},
            resources: {
                [objectPath]: {
                    path: objectPath,
                    name: "oCamera",
                    resourceType: "GMObject",
                    assetReferences: []
                },
                [scriptPath]: {
                    path: scriptPath,
                    name: "AssetLoader",
                    resourceType: "GMScript",
                    assetReferences: []
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, projectRoot);
        const objectRenameEdits = bridge.getAdditionalSymbolEdits("gml/objects/oCamera", "obj_o_camera");

        assert.ok(objectRenameEdits, "Expected edits for the object rename");
        const firstResourceOrderEdit = objectRenameEdits.metadataEdits.find(
            (entry) => entry.path === resourceOrderPath
        );
        assert.ok(firstResourceOrderEdit);
        assert.match(firstResourceOrderEdit.content, /"name"\s*:\s*"obj_o_camera"/);
        assert.match(firstResourceOrderEdit.content, /"path"\s*:\s*"objects\/obj_o_camera\/obj_o_camera\.yy"/);
        assert.match(firstResourceOrderEdit.content, /"name"\s*:\s*"AssetLoader"/);
        assert.match(firstResourceOrderEdit.content, /"path"\s*:\s*"scripts\/AssetLoader\/AssetLoader\.yy"/);

        bridge.stageWorkspaceEdit(objectRenameEdits);

        const scriptRenameEdits = bridge.getAdditionalSymbolEdits("gml/scripts/AssetLoader", "asset_loader");

        assert.ok(scriptRenameEdits, "Expected edits for the script rename");
        const stagedResourceOrderEdit = scriptRenameEdits.metadataEdits.find(
            (entry) => entry.path === resourceOrderPath
        );
        assert.ok(stagedResourceOrderEdit);
        assert.match(stagedResourceOrderEdit.content, /"name"\s*:\s*"obj_o_camera"/);
        assert.match(stagedResourceOrderEdit.content, /"path"\s*:\s*"objects\/obj_o_camera\/obj_o_camera\.yy"/);
        assert.match(stagedResourceOrderEdit.content, /"name"\s*:\s*"asset_loader"/);
        assert.match(stagedResourceOrderEdit.content, /"path"\s*:\s*"scripts\/asset_loader\/asset_loader\.yy"/);
        assert.match(stagedResourceOrderEdit.content, /"name"\s*:\s*"oGoal"/);
        assert.match(stagedResourceOrderEdit.content, /"path"\s*:\s*"objects\/oGoal\/oGoal\.yy"/);
    });

    void it("getAdditionalSymbolEdits replaces project manifest entries in-place", () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-manifest-inplace-"));
        const resourcePath = "objects/oGravitySphere/oGravitySphere.yy";
        const projectManifestPath = "project.yyp";

        const resourceAbsolute = path.join(tmpRoot, resourcePath);
        const projectManifestAbsolute = path.join(tmpRoot, projectManifestPath);
        fs.mkdirSync(path.dirname(resourceAbsolute), { recursive: true });

        fs.writeFileSync(
            resourceAbsolute,
            `{"%Name":"oGravitySphere","name":"oGravitySphere","resourceType":"GMObject","resourcePath":"objects/oGravitySphere/oGravitySphere.yy",}`,
            "utf8"
        );
        fs.writeFileSync(
            projectManifestAbsolute,
            `{"name":"MyGame","resourceType":"GMProject","resources":[{"id":{"%Name":"oGravitySphere","name":"oGravitySphere","path":"objects/oGravitySphere/oGravitySphere.yy"}}]}`,
            "utf8"
        );

        const mockProjectIndex = {
            identifiers: {},
            resources: {
                [resourcePath]: {
                    path: resourcePath,
                    name: "oGravitySphere",
                    resourceType: "GMObject",
                    assetReferences: []
                },
                [projectManifestPath]: {
                    path: projectManifestPath,
                    name: "MyGame",
                    resourceType: "GMProject",
                    assetReferences: [
                        {
                            propertyPath: "resources.0.id",
                            targetPath: resourcePath,
                            targetName: "oGravitySphere"
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const edits = bridge.getAdditionalSymbolEdits("gml/objects/oGravitySphere", "oGravityWell");

        assert.ok(edits, "Expected additional edits for resource rename");

        const manifestEdit = edits.metadataEdits.find((entry) => entry.path === projectManifestPath);
        assert.ok(manifestEdit);
        assert.match(manifestEdit.content, /"name"\s*:\s*"oGravityWell"/);
        assert.match(manifestEdit.content, /"path"\s*:\s*"objects\/oGravityWell\/oGravityWell\.yy"/);
        assert.doesNotMatch(manifestEdit.content, /"name"\s*:\s*"oGravitySphere"/);
    });

    void it("getAdditionalSymbolEdits normalizes resourceType before resourcePath ordering", () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-normalization-"));
        const resourcePath = "objects/oGravitySphere/oGravitySphere.yy";
        const projectManifestPath = "project.yyp";

        const resourceAbsolute = path.join(tmpRoot, resourcePath);
        const projectManifestAbsolute = path.join(tmpRoot, projectManifestPath);
        fs.mkdirSync(path.dirname(resourceAbsolute), { recursive: true });

        fs.writeFileSync(
            resourceAbsolute,
            `{"%Name":"oGravitySphere","name":"oGravitySphere","resourcePath":"objects/oGravitySphere/oGravitySphere.yy","resourceType":"GMObject"}`,
            "utf8"
        );
        fs.writeFileSync(
            projectManifestAbsolute,
            `{"name":"MyGame","resourceType":"GMProject","resources":[{"id":{"%Name":"oGravitySphere","name":"oGravitySphere","path":"objects/oGravitySphere/oGravitySphere.yy"}}]}`,
            "utf8"
        );

        const mockProjectIndex = {
            identifiers: {},
            resources: {
                [resourcePath]: {
                    path: resourcePath,
                    name: "oGravitySphere",
                    resourceType: "GMObject",
                    assetReferences: []
                },
                [projectManifestPath]: {
                    path: projectManifestPath,
                    name: "MyGame",
                    resourceType: "GMProject",
                    assetReferences: [
                        {
                            propertyPath: "resources.0.id",
                            targetPath: resourcePath,
                            targetName: "oGravitySphere"
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const edits = bridge.getAdditionalSymbolEdits("gml/objects/oGravitySphere", "oGravityWell");

        assert.ok(edits);

        const resourceEdit = edits.metadataEdits.find((entry) => entry.path === resourcePath);
        assert.ok(resourceEdit);

        // Legacy script metadata may not include resourcePath. Refactor should not
        // inject resourcePath on the resource file body itself unless it was
        // already present.
        const containsResourcePath = resourceEdit.content.includes('"resourcePath"');
        assert.ok(containsResourcePath, "resourcePath should be present because it was in the source");

        const typeIndex = resourceEdit.content.indexOf('"resourceType"');
        assert.ok(typeIndex !== -1, "resourceType should remain present");
    });

    void it("getAdditionalSymbolEdits composes staged project metadata edits across sequential resource renames", () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-batch-"));
        const objectPath = "objects/oGravitySphere/oGravitySphere.yy";
        const spritePath = "sprites/sEnemy/sEnemy.yy";
        const projectManifestPath = "project.yyp";

        const objectAbsolute = path.join(tmpRoot, objectPath);
        const spriteAbsolute = path.join(tmpRoot, spritePath);
        const projectManifestAbsolute = path.join(tmpRoot, projectManifestPath);
        fs.mkdirSync(path.dirname(objectAbsolute), { recursive: true });
        fs.mkdirSync(path.dirname(spriteAbsolute), { recursive: true });

        fs.writeFileSync(
            objectAbsolute,
            `{"%Name":"oGravitySphere","name":"oGravitySphere","resourceType":"GMObject","resourcePath":"objects/oGravitySphere/oGravitySphere.yy",}`,
            "utf8"
        );
        fs.writeFileSync(
            spriteAbsolute,
            `{"name":"sEnemy","resourceType":"GMSprite","resourcePath":"sprites/sEnemy/sEnemy.yy",}`,
            "utf8"
        );
        fs.writeFileSync(
            projectManifestAbsolute,
            `{
                "name":"MyGame",
                "resourceType":"GMProject",
                "resources":[
                    {"id":{"%Name":"oGravitySphere","name":"oGravitySphere","path":"objects/oGravitySphere/oGravitySphere.yy",}},
                    {"id":{"name":"sEnemy","path":"sprites/sEnemy/sEnemy.yy",}}
                ],
            }`,
            "utf8"
        );

        const mockProjectIndex = {
            identifiers: {},
            resources: {
                [objectPath]: {
                    path: objectPath,
                    name: "oGravitySphere",
                    resourceType: "GMObject",
                    assetReferences: []
                },
                [spritePath]: {
                    path: spritePath,
                    name: "sEnemy",
                    resourceType: "GMSprite",
                    assetReferences: []
                },
                [projectManifestPath]: {
                    path: projectManifestPath,
                    name: "MyGame",
                    resourceType: "GMProject",
                    assetReferences: [
                        {
                            propertyPath: "resources.0.id",
                            targetPath: objectPath,
                            targetName: "oGravitySphere"
                        },
                        {
                            propertyPath: "resources.1.id",
                            targetPath: spritePath,
                            targetName: "sEnemy"
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const firstEdits = bridge.getAdditionalSymbolEdits("gml/objects/oGravitySphere", "oGravityWell");
        assert.ok(firstEdits);

        bridge.stageWorkspaceEdit({ metadataEdits: firstEdits.metadataEdits });

        const secondEdits = bridge.getAdditionalSymbolEdits("gml/sprites/sEnemy", "sFoe");
        const stagedManifestEdit = secondEdits?.metadataEdits.find((entry) => entry.path === projectManifestPath);

        assert.ok(stagedManifestEdit);
        assert.match(stagedManifestEdit.content, /"name"\s*:\s*"oGravityWell"/);
        assert.match(stagedManifestEdit.content, /"path"\s*:\s*"objects\/oGravityWell\/oGravityWell\.yy"/);
        assert.match(stagedManifestEdit.content, /"name"\s*:\s*"sFoe"/);
        assert.match(stagedManifestEdit.content, /"path"\s*:\s*"sprites\/sFoe\/sFoe\.yy"/);

        bridge.clearWorkspaceOverlay();

        const resetEdits = bridge.getAdditionalSymbolEdits("gml/sprites/sEnemy", "sFoe");
        const resetManifestEdit = resetEdits?.metadataEdits.find((entry) => entry.path === projectManifestPath);

        assert.ok(resetManifestEdit);
        assert.doesNotMatch(resetManifestEdit.content, /"name"\s*:\s*"oGravityWell"/);
    });

    void it("getAdditionalSymbolEdits resolves staged directory renames for sibling object resources in shared folders", () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-shared-object-folder-"));
        const parentObjectPath = "objects/oColmesh2DemoCylinder/oColmesh2DemoCylinder.yy";
        const siblingObjectPath = "objects/oColmesh2DemoCylinder/oColmeshDemo2Sphere.yy";
        const projectManifestPath = "project.yyp";

        const parentObjectAbsolute = path.join(tmpRoot, parentObjectPath);
        const siblingObjectAbsolute = path.join(tmpRoot, siblingObjectPath);
        const projectManifestAbsolute = path.join(tmpRoot, projectManifestPath);
        fs.mkdirSync(path.dirname(parentObjectAbsolute), { recursive: true });

        fs.writeFileSync(
            parentObjectAbsolute,
            `{"name":"oColmesh2DemoCylinder","resourceType":"GMObject","resourcePath":"objects/oColmesh2DemoCylinder/oColmesh2DemoCylinder.yy",}`,
            "utf8"
        );
        fs.writeFileSync(
            siblingObjectAbsolute,
            `{"name":"oColmeshDemo2Sphere","resourceType":"GMObject","resourcePath":"objects/oColmesh2DemoCylinder/oColmeshDemo2Sphere.yy",}`,
            "utf8"
        );
        fs.writeFileSync(
            projectManifestAbsolute,
            `{
                "name":"MyGame",
                "resourceType":"GMProject",
                "resources":[
                    {"id":{"name":"oColmesh2DemoCylinder","path":"objects/oColmesh2DemoCylinder/oColmesh2DemoCylinder.yy",}},
                    {"id":{"name":"oColmeshDemo2Sphere","path":"objects/oColmesh2DemoCylinder/oColmeshDemo2Sphere.yy",}}
                ],
            }`,
            "utf8"
        );

        const mockProjectIndex = {
            identifiers: {},
            resources: {
                [parentObjectPath]: {
                    path: parentObjectPath,
                    name: "oColmesh2DemoCylinder",
                    resourceType: "GMObject",
                    assetReferences: []
                },
                [siblingObjectPath]: {
                    path: siblingObjectPath,
                    name: "oColmeshDemo2Sphere",
                    resourceType: "GMObject",
                    assetReferences: []
                },
                [projectManifestPath]: {
                    path: projectManifestPath,
                    name: "MyGame",
                    resourceType: "GMProject",
                    assetReferences: [
                        {
                            propertyPath: "resources.0.id",
                            targetPath: parentObjectPath,
                            targetName: "oColmesh2DemoCylinder"
                        },
                        {
                            propertyPath: "resources.1.id",
                            targetPath: siblingObjectPath,
                            targetName: "oColmeshDemo2Sphere"
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const parentRenameEdits = bridge.getAdditionalSymbolEdits(
            "gml/objects/oColmesh2DemoCylinder",
            "obj_o_colmesh2demo_cylinder"
        );
        assert.ok(parentRenameEdits);
        bridge.stageWorkspaceEdit(parentRenameEdits);

        const siblingRenameEdits = bridge.getAdditionalSymbolEdits(
            "gml/objects/oColmeshDemo2Sphere",
            "obj_o_colmesh_demo2sphere"
        );
        assert.ok(siblingRenameEdits);

        assert.deepEqual(siblingRenameEdits.fileRenames, [
            {
                oldPath: "objects/obj_o_colmesh2demo_cylinder/oColmeshDemo2Sphere.yy",
                newPath: "objects/obj_o_colmesh2demo_cylinder/obj_o_colmesh_demo2sphere.yy"
            }
        ]);

        const siblingMetadataEdit = siblingRenameEdits.metadataEdits.find((entry) => entry.path === siblingObjectPath);
        assert.ok(siblingMetadataEdit);
        assert.match(
            siblingMetadataEdit.content,
            /"resourcePath"\s*:\s*"objects\/obj_o_colmesh2demo_cylinder\/obj_o_colmesh_demo2sphere\.yy"/
        );

        const manifestEdit = siblingRenameEdits.metadataEdits.find((entry) => entry.path === projectManifestPath);
        assert.ok(manifestEdit);
        assert.match(manifestEdit.content, /"name"\s*:\s*"obj_o_colmesh2demo_cylinder"/);
        assert.match(manifestEdit.content, /"name"\s*:\s*"obj_o_colmesh_demo2sphere"/);
        assert.match(
            manifestEdit.content,
            /"path"\s*:\s*"objects\/obj_o_colmesh2demo_cylinder\/obj_o_colmesh_demo2sphere\.yy"/
        );
    });

    void it("getAdditionalSymbolEdits preserves room float metadata across sequential staged rewrites", () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-room-floats-"));
        const playerPath = "objects/oPlayer/oPlayer.yy";
        const goalPath = "objects/oGoal/oGoal.yy";
        const roomPath = "rooms/rm_level/rm_level.yy";

        const playerAbsolute = path.join(tmpRoot, playerPath);
        const goalAbsolute = path.join(tmpRoot, goalPath);
        const roomAbsolute = path.join(tmpRoot, roomPath);
        fs.mkdirSync(path.dirname(playerAbsolute), { recursive: true });
        fs.mkdirSync(path.dirname(goalAbsolute), { recursive: true });
        fs.mkdirSync(path.dirname(roomAbsolute), { recursive: true });

        fs.writeFileSync(
            playerAbsolute,
            `{"name":"oPlayer","resourceType":"GMObject","resourcePath":"objects/oPlayer/oPlayer.yy",}`,
            "utf8"
        );
        fs.writeFileSync(
            goalAbsolute,
            `{"name":"oGoal","resourceType":"GMObject","resourcePath":"objects/oGoal/oGoal.yy",}`,
            "utf8"
        );
        fs.writeFileSync(
            roomAbsolute,
            `{
              "$GMRoom":"v1",
              "%Name":"rm_level",
              "creationCodeFile":"",
              "inheritCode":false,
              "inheritCreationOrder":false,
              "inheritLayers":false,
              "instanceCreationOrder":[
                {"name":"inst_104A19B6","path":"rooms/rm_level/rm_level.yy",},
                {"name":"inst_722E568F","path":"rooms/rm_level/rm_level.yy",},
              ],
              "isDnd":false,
              "layers":[
                {"$GMRInstanceLayer":"","%Name":"Instances_3","depth":100,"effectEnabled":true,"effectType":null,"gridX":32,"gridY":32,"hierarchyFrozen":false,"inheritLayerDepth":false,"inheritLayerSettings":false,"inheritSubLayers":true,"inheritVisibility":true,"instances":[
                    {"$GMRInstance":"v4","%Name":"inst_104A19B6","colour":4294967295,"frozen":false,"hasCreationCode":false,"ignore":false,"imageIndex":0,"imageSpeed":1.0,"inheritCode":false,"inheritedItemId":null,"inheritItemSettings":false,"isDnd":false,"name":"inst_104A19B6","objectId":{"name":"oPlayer","path":"objects/oPlayer/oPlayer.yy",},"properties":[],"resourceType":"GMRInstance","resourceVersion":"2.0","rotation":3.7500002,"scaleX":1.7499999,"scaleY":1.0,"x":640.0,"y":480.0,},
                    {"$GMRInstance":"v4","%Name":"inst_722E568F","colour":4294967295,"frozen":false,"hasCreationCode":false,"ignore":false,"imageIndex":0,"imageSpeed":1.0,"inheritCode":false,"inheritedItemId":null,"inheritItemSettings":false,"isDnd":false,"name":"inst_722E568F","objectId":{"name":"oGoal","path":"objects/oGoal/oGoal.yy",},"properties":[],"resourceType":"GMRInstance","resourceVersion":"2.0","rotation":0.0,"scaleX":1.0,"scaleY":1.0,"x":1056.0,"y":544.0,},
                  ],"layers":[],"name":"Instances_3","properties":[],"resourceType":"GMRInstanceLayer","resourceVersion":"2.0","userdefinedDepth":false,"visible":true,},
                {"$GMRBackgroundLayer":"","%Name":"Background","animationFPS":15.0,"animationSpeedType":0,"colour":4278190080,"depth":300,"effectEnabled":true,"effectType":null,"gridX":32,"gridY":32,"hierarchyFrozen":false,"hspeed":0.0,"htiled":false,"inheritLayerDepth":false,"inheritLayerSettings":false,"inheritSubLayers":true,"inheritVisibility":true,"layers":[],"name":"Background","properties":[],"resourceType":"GMRBackgroundLayer","resourceVersion":"2.0","spriteId":null,"stretch":false,"userdefinedAnimFPS":false,"userdefinedDepth":false,"visible":true,"vspeed":0.0,"vtiled":false,"x":0,"y":0,},
              ],
              "name":"rm_level",
              "parent":{"name":"Rooms","path":"folders/Rooms.yy",},
              "parentRoom":null,
              "physicsSettings":{"inheritPhysicsSettings":false,"PhysicsWorld":false,"PhysicsWorldGravityX":0.0,"PhysicsWorldGravityY":10.0,"PhysicsWorldPixToMetres":0.1,},
              "resourceType":"GMRoom",
              "resourceVersion":"2.0",
              "roomSettings":{"Height":1080,"inheritRoomSettings":false,"persistent":false,"Width":1920,},
              "sequenceId":null,
              "views":[
                {"hborder":32,"hport":768,"hspeed":-1,"hview":768,"inherit":false,"objectId":null,"vborder":32,"visible":false,"vspeed":-1,"wport":1366,"wview":1366,"xport":0,"xview":0,"yport":0,"yview":0,},
                {"hborder":32,"hport":768,"hspeed":-1,"hview":768,"inherit":false,"objectId":null,"vborder":32,"visible":false,"vspeed":-1,"wport":1366,"wview":1366,"xport":0,"xview":0,"yport":0,"yview":0,},
                {"hborder":32,"hport":768,"hspeed":-1,"hview":768,"inherit":false,"objectId":null,"vborder":32,"visible":false,"vspeed":-1,"wport":1366,"wview":1366,"xport":0,"xview":0,"yport":0,"yview":0,},
                {"hborder":32,"hport":768,"hspeed":-1,"hview":768,"inherit":false,"objectId":null,"vborder":32,"visible":false,"vspeed":-1,"wport":1366,"wview":1366,"xport":0,"xview":0,"yport":0,"yview":0,},
                {"hborder":32,"hport":768,"hspeed":-1,"hview":768,"inherit":false,"objectId":null,"vborder":32,"visible":false,"vspeed":-1,"wport":1366,"wview":1366,"xport":0,"xview":0,"yport":0,"yview":0,},
                {"hborder":32,"hport":768,"hspeed":-1,"hview":768,"inherit":false,"objectId":null,"vborder":32,"visible":false,"vspeed":-1,"wport":1366,"wview":1366,"xport":0,"xview":0,"yport":0,"yview":0,},
                {"hborder":32,"hport":768,"hspeed":-1,"hview":768,"inherit":false,"objectId":null,"vborder":32,"visible":false,"vspeed":-1,"wport":1366,"wview":1366,"xport":0,"xview":0,"yport":0,"yview":0,},
                {"hborder":32,"hport":768,"hspeed":-1,"hview":768,"inherit":false,"objectId":null,"vborder":32,"visible":false,"vspeed":-1,"wport":1366,"wview":1366,"xport":0,"xview":0,"yport":0,"yview":0,},
              ],
              "viewSettings":{"clearDisplayBuffer":true,"clearViewBackground":false,"enableViews":false,"inheritViewSettings":false,},
              "volume":1.0,
            }`,
            "utf8"
        );

        const mockProjectIndex = {
            identifiers: {},
            resources: {
                [playerPath]: {
                    path: playerPath,
                    name: "oPlayer",
                    resourceType: "GMObject",
                    assetReferences: []
                },
                [goalPath]: {
                    path: goalPath,
                    name: "oGoal",
                    resourceType: "GMObject",
                    assetReferences: []
                },
                [roomPath]: {
                    path: roomPath,
                    name: "rm_level",
                    resourceType: "GMRoom",
                    assetReferences: [
                        {
                            propertyPath: "layers.0.instances.0.objectId",
                            targetPath: playerPath,
                            targetName: "oPlayer"
                        },
                        {
                            propertyPath: "layers.0.instances.1.objectId",
                            targetPath: goalPath,
                            targetName: "oGoal"
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const firstEdits = bridge.getAdditionalSymbolEdits("gml/objects/oPlayer", "oHero");
        assert.ok(firstEdits);
        bridge.stageWorkspaceEdit({ metadataEdits: firstEdits.metadataEdits });

        const secondEdits = bridge.getAdditionalSymbolEdits("gml/objects/oGoal", "oEndGoal");
        const roomEdit = secondEdits?.metadataEdits.find((entry) => entry.path === roomPath);

        assert.ok(roomEdit);
        assert.match(roomEdit.content, /"name":"oHero"/u);
        assert.match(roomEdit.content, /"path":"objects\/oHero\/oHero\.yy"/u);
        assert.match(roomEdit.content, /"name":"oEndGoal"/u);
        assert.match(roomEdit.content, /"path":"objects\/oEndGoal\/oEndGoal\.yy"/u);
        assert.match(roomEdit.content, /"imageSpeed":1\.0/u);
        assert.match(roomEdit.content, /"rotation":3\.7500002/u);
        assert.match(roomEdit.content, /"scaleX":1\.7499999/u);
        assert.match(roomEdit.content, /"scaleY":1\.0/u);
        assert.match(roomEdit.content, /"animationFPS":15\.0/u);
        assert.match(roomEdit.content, /"PhysicsWorldGravityY":10\.0/u);
        assert.match(roomEdit.content, /"PhysicsWorldPixToMetres":0\.1/u);
        assert.match(roomEdit.content, /"volume":1\.0/u);
        assert.doesNotMatch(roomEdit.content, /:\{\}/u);
    });

    void it("getAdditionalSymbolEdits updates room instanceCreationOrder self-path without mutating instance IDs", () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-room-rename-"));
        const roomOldPath = "rooms/Room1/Room1.yy";
        try {
            const roomAbsolute = path.join(tmpRoot, roomOldPath);
            fs.mkdirSync(path.dirname(roomAbsolute), { recursive: true });

            fs.writeFileSync(
                roomAbsolute,
                `{
              "$GMRoom":"v1",
              "%Name":"Room1",
              "instanceCreationOrder":[
                {"name":"inst_7056BF4E","path":"rooms/Room1/Room1.yy",},
              ],
              "layers":[
                {"$GMRInstanceLayer":"","instances":[
                    {"$GMRInstance":"v4","name":"inst_7056BF4E","objectId":{"name":"oSpider","path":"objects/oSpider/oSpider.yy",},"resourceType":"GMRInstance","resourceVersion":"2.0",},
                  ],"resourceType":"GMRInstanceLayer","resourceVersion":"2.0",},
              ],
              "name":"Room1",
              "resourceType":"GMRoom",
              "resourceVersion":"2.0",
            }`,
                "utf8"
            );

            const mockProjectIndex = {
                identifiers: {},
                resources: {
                    [roomOldPath]: {
                        path: roomOldPath,
                        name: "Room1",
                        resourceType: "GMRoom",
                        assetReferences: []
                    }
                }
            };

            const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
            const roomRenameEdits = bridge.getAdditionalSymbolEdits("gml/rooms/Room1", "rm_room1");
            assert.ok(roomRenameEdits);

            assert.deepStrictEqual(roomRenameEdits.fileRenames, [
                {
                    oldPath: roomOldPath,
                    newPath: "rooms/Room1/rm_room1.yy"
                },
                {
                    oldPath: "rooms/Room1",
                    newPath: "rooms/rm_room1"
                }
            ]);

            const roomMetadataEdit = roomRenameEdits.metadataEdits.find((entry) => entry.path === roomOldPath);
            assert.ok(roomMetadataEdit);
            assert.match(roomMetadataEdit.content, /"%Name":"rm_room1"/u);
            assert.match(roomMetadataEdit.content, /"name":"rm_room1"/u);
            assert.match(
                roomMetadataEdit.content,
                /"instanceCreationOrder":\[\s*\{"name":"inst_7056BF4E","path":"rooms\/rm_room1\/rm_room1\.yy",\}/u
            );
            assert.match(roomMetadataEdit.content, /"name":"inst_7056BF4E"/u);
        } finally {
            fs.rmSync(tmpRoot, {
                recursive: true,
                force: true
            });
        }
    });

    void it("getAdditionalSymbolEdits skips unrelated metadata files that would only change via canonical serialization", () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-unrelated-metadata-"));
        const objectPath = "objects/oGravitySphere/oGravitySphere.yy";
        const projectManifestPath = "project.yyp";
        const soundPath = "sounds/sndColmeshDemo2Coin/sndColmeshDemo2Coin.yy";
        const spritePath = "sprites/sprPlayer/sprPlayer.yy";

        const objectAbsolute = path.join(tmpRoot, objectPath);
        const projectManifestAbsolute = path.join(tmpRoot, projectManifestPath);
        const soundAbsolute = path.join(tmpRoot, soundPath);
        const spriteAbsolute = path.join(tmpRoot, spritePath);
        fs.mkdirSync(path.dirname(objectAbsolute), { recursive: true });
        fs.mkdirSync(path.dirname(soundAbsolute), { recursive: true });
        fs.mkdirSync(path.dirname(spriteAbsolute), { recursive: true });

        fs.writeFileSync(
            objectAbsolute,
            `{"%Name":"oGravitySphere","name":"oGravitySphere","resourceType":"GMObject","resourcePath":"objects/oGravitySphere/oGravitySphere.yy",}`,
            "utf8"
        );
        fs.writeFileSync(
            projectManifestAbsolute,
            `{"name":"MyGame","resourceType":"GMProject","resources":[{"id":{"%Name":"oGravitySphere","name":"oGravitySphere","path":"objects/oGravitySphere/oGravitySphere.yy",}}],}`,
            "utf8"
        );
        fs.writeFileSync(
            soundAbsolute,
            `{
              "$GMSound":"v2",
              "%Name":"sndColmeshDemo2Coin",
              "audioGroupId":{"name":"audiogroup_default","path":"audiogroups/audiogroup_default",},
              "bitDepth":1,
              "channelFormat":0,
              "compression":0,
              "compressionQuality":4,
              "conversionMode":0,
              "duration":1.149388,
              "exportDir":"",
              "name":"sndColmeshDemo2Coin",
              "parent":{"name":"Demo","path":"folders/Libraries/ColMesh/Demo.yy",},
              "preload":false,
              "resourceType":"GMSound",
              "resourceVersion":"2.0",
              "sampleRate":44100,
              "soundFile":"sndColmeshDemo2Coin.mp3",
              "volume":1.0,
            }`,
            "utf8"
        );
        fs.writeFileSync(
            spriteAbsolute,
            `{
              "$GMSprite":"v2",
              "%Name":"sprPlayer",
              "bboxMode":0,
              "bbox_bottom":31,
              "bbox_left":0,
              "bbox_right":31,
              "bbox_top":0,
              "collisionKind":1,
              "collisionTolerance":0,
              "DynamicTexturePage":false,
              "edgeFiltering":false,
              "For3D":false,
              "frames":[{"$GMSpriteFrame":"v1","%Name":"a777fc4d-ac59-4464-b4bd-e93704762166","name":"a777fc4d-ac59-4464-b4bd-e93704762166","resourceType":"GMSpriteFrame","resourceVersion":"2.0",},],
              "gridX":0,
              "gridY":0,
              "height":32,
              "HTile":false,
              "layers":[{"$GMImageLayer":"","%Name":"c7545ec4-2c29-4b5e-9814-c7ec66e59442","blendMode":0,"displayName":"default","isLocked":false,"name":"c7545ec4-2c29-4b5e-9814-c7ec66e59442","opacity":100.0,"resourceType":"GMImageLayer","resourceVersion":"2.0","visible":true,},],
              "name":"sprPlayer",
              "nineSlice":null,
              "origin":4,
              "parent":{"name":"Sprites","path":"folders/02 Textures/Sprites.yy",},
              "preMultiplyAlpha":false,
              "resourceType":"GMSprite",
              "resourceVersion":"2.0",
              "sequence":{"$GMSequence":"v1","%Name":"sprPlayer","autoRecord":true,"backdropHeight":768,"backdropImageOpacity":0.5,"backdropImagePath":"","backdropWidth":1366,"backdropXOffset":0.0,"backdropYOffset":0.0,"events":{"$KeyframeStore<MessageEventKeyframe>":"","Keyframes":[],"resourceType":"KeyframeStore<MessageEventKeyframe>","resourceVersion":"2.0",},"eventStubScript":null,"eventToFunction":{},"length":1.0,"lockOrigin":false,"moments":{"$KeyframeStore<MomentsEventKeyframe>":"","Keyframes":[],"resourceType":"KeyframeStore<MomentsEventKeyframe>","resourceVersion":"2.0",},"name":"sprPlayer","playback":1,"playbackSpeed":30.0,"playbackSpeedType":0,"resourceType":"GMSequence","resourceVersion":"2.0","seqHeight":32.0,"seqWidth":32.0,"showBackdrop":true,"showBackdropImage":false,"timeUnits":1,"tracks":[{"$GMSpriteFramesTrack":"","builtinName":0,"events":[],"inheritsTrackColour":true,"interpolation":1,"isCreationTrack":false,"keyframes":{"$KeyframeStore<SpriteFrameKeyframe>":"","Keyframes":[{"$Keyframe<SpriteFrameKeyframe>":"","Channels":{"0":{"$SpriteFrameKeyframe":"","Id":{"name":"a777fc4d-ac59-4464-b4bd-e93704762166","path":"sprites/sprPlayer/sprPlayer.yy",},"resourceType":"SpriteFrameKeyframe","resourceVersion":"2.0",}},"Disabled":false,"id":"213eb663-edd6-48de-82c6-c2a8d2c0ebb7","IsCreationKey":false,"Key":0.0,"Length":1.0,"resourceType":"Keyframe<SpriteFrameKeyframe>","resourceVersion":"2.0","Stretch":false,},],"resourceType":"KeyframeStore<SpriteFrameKeyframe>","resourceVersion":"2.0",},"modifiers":[],"name":"frames","resourceType":"GMSpriteFramesTrack","resourceVersion":"2.0","spriteId":null,"trackColour":0,"tracks":[],"traits":0,},],"visibleRange":null,"volume":1.0,"xorigin":16,"yorigin":16,},
              "swatchColours":null,
              "swfPrecision":2.525,
              "textureGroupId":{"name":"Default","path":"texturegroups/Default",},
              "type":0,
              "VTile":false,
              "width":32,
            }`,
            "utf8"
        );

        const mockProjectIndex = {
            identifiers: {},
            resources: {
                [objectPath]: {
                    path: objectPath,
                    name: "oGravitySphere",
                    resourceType: "GMObject",
                    assetReferences: []
                },
                [projectManifestPath]: {
                    path: projectManifestPath,
                    name: "MyGame",
                    resourceType: "GMProject",
                    assetReferences: [
                        {
                            propertyPath: "resources.0.id",
                            targetPath: objectPath,
                            targetName: "oGravitySphere"
                        }
                    ]
                },
                [soundPath]: {
                    path: soundPath,
                    name: "sndColmeshDemo2Coin",
                    resourceType: "GMSound",
                    assetReferences: []
                },
                [spritePath]: {
                    path: spritePath,
                    name: "sprPlayer",
                    resourceType: "GMSprite",
                    assetReferences: []
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const edits = bridge.getAdditionalSymbolEdits("gml/objects/oGravitySphere", "oGravityWell");

        assert.ok(edits);
        assert.ok(edits.metadataEdits.some((entry) => entry.path === objectPath));
        assert.ok(edits.metadataEdits.some((entry) => entry.path === projectManifestPath));
        assert.ok(!edits.metadataEdits.some((entry) => entry.path === soundPath));
        assert.ok(!edits.metadataEdits.some((entry) => entry.path === spritePath));
    });

    void it("listNamingConventionTargets classifies resource, callable, macro, global, and local targets", async () => {
        const mockProjectIndex = {
            resources: {
                "scripts/demo_script/demo_script.yy": {
                    path: "scripts/demo_script/demo_script.yy",
                    name: "demo_script",
                    resourceType: "GMScript"
                },
                "paths/pth_enemy_route/pth_enemy_route.yy": {
                    path: "paths/pth_enemy_route/pth_enemy_route.yy",
                    name: "pth_enemy_route",
                    resourceType: "GMPath"
                },
                "animcurves/curve_attack_arc/curve_attack_arc.yy": {
                    path: "animcurves/curve_attack_arc/curve_attack_arc.yy",
                    name: "curve_attack_arc",
                    resourceType: "GMAnimCurve"
                },
                "sequences/seq_intro/seq_intro.yy": {
                    path: "sequences/seq_intro/seq_intro.yy",
                    name: "seq_intro",
                    resourceType: "GMSequence"
                },
                "tilesets/tile_world/tile_world.yy": {
                    path: "tilesets/tile_world/tile_world.yy",
                    name: "tile_world",
                    resourceType: "GMTileSet"
                },
                "particlesystems/part_trail/part_trail.yy": {
                    path: "particlesystems/part_trail/part_trail.yy",
                    name: "part_trail",
                    resourceType: "GMParticleSystem"
                },
                "notes/note_design/note_design.yy": {
                    path: "notes/note_design/note_design.yy",
                    name: "note_design",
                    resourceType: "GMNote"
                },
                "extensions/ext_physics/ext_physics.yy": {
                    path: "extensions/ext_physics/ext_physics.yy",
                    name: "ext_physics",
                    resourceType: "GMExtension"
                }
            },
            identifiers: {
                scripts: {
                    "scope:script:demo_script": {
                        identifierId: "script:scope:script:demo_script",
                        name: "demo_script",
                        resourcePath: "scripts/demo_script/demo_script.yy",
                        declarations: [
                            {
                                name: "demo_script",
                                filePath: "scripts/demo_script/demo_script.gml",
                                classifications: ["script"]
                            }
                        ]
                    },
                    "scope:script:build_widget": {
                        identifierId: "script:scope:script:build_widget",
                        name: "build_widget",
                        declarations: [
                            {
                                name: "build_widget",
                                filePath: "scripts/demo_script/demo_script.gml",
                                classifications: ["function", "constructor"]
                            }
                        ]
                    }
                },
                macros: {
                    DEMO_MACRO: {
                        identifierId: "macro:DEMO_MACRO",
                        name: "DEMO_MACRO",
                        declarations: [
                            {
                                name: "DEMO_MACRO",
                                filePath: "scripts/demo_script/demo_script.gml"
                            }
                        ]
                    }
                },
                globalVariables: {
                    global_score: {
                        identifierId: "global:global_score",
                        name: "global_score",
                        declarations: [
                            {
                                name: "global_score",
                                filePath: "scripts/demo_script/demo_script.gml"
                            }
                        ]
                    }
                },
                enums: {
                    state_enum: {
                        identifierId: "enum:state_enum",
                        name: "state_enum",
                        declarations: [
                            {
                                name: "state_enum",
                                filePath: "scripts/demo_script/demo_script.gml"
                            }
                        ]
                    }
                },
                enumMembers: {
                    "enum-member:ready": {
                        identifierId: "enum-member:ready",
                        name: "ready_state",
                        declarations: [
                            {
                                name: "ready_state",
                                filePath: "scripts/demo_script/demo_script.gml",
                                start: { index: 120 },
                                end: { index: 131 }
                            }
                        ],
                        references: [
                            {
                                filePath: "scripts/demo_script/demo_script.gml",
                                start: { index: 150 },
                                end: { index: 161 }
                            }
                        ]
                    }
                },
                instanceVariables: {}
            },
            scopes: {
                "scope:catch": {
                    kind: "catch"
                }
            },
            files: {
                "scripts/demo_script/demo_script.gml": {
                    declarations: [
                        {
                            name: "bad_name",
                            scopeId: "scope:local",
                            classifications: ["variable"],
                            start: { index: 4 },
                            end: { index: 12 }
                        },
                        {
                            name: "err_value",
                            scopeId: "scope:catch",
                            classifications: ["parameter"],
                            start: { index: 30 },
                            end: { index: 39 }
                        }
                    ],
                    references: [
                        {
                            name: "bad_name",
                            scopeId: "scope:local",
                            start: { index: 60 },
                            end: { index: 68 },
                            declaration: {
                                name: "bad_name",
                                scopeId: "scope:local",
                                start: { index: 4 }
                            }
                        },
                        {
                            name: "err_value",
                            scopeId: "scope:catch",
                            start: { index: 90 },
                            end: { index: 99 },
                            declaration: {
                                name: "err_value",
                                scopeId: "scope:catch",
                                start: { index: 30 }
                            }
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");
        const targets = await bridge.listNamingConventionTargets();

        assert.ok(targets.some((target) => target.category === "scriptResourceName" && target.name === "demo_script"));
        assert.ok(
            targets.some((target) => target.category === "pathResourceName" && target.name === "pth_enemy_route")
        );
        assert.ok(
            targets.some(
                (target) => target.category === "animationCurveResourceName" && target.name === "curve_attack_arc"
            )
        );
        assert.ok(targets.some((target) => target.category === "sequenceResourceName" && target.name === "seq_intro"));
        assert.ok(targets.some((target) => target.category === "tilesetResourceName" && target.name === "tile_world"));
        assert.ok(
            targets.some((target) => target.category === "particleSystemResourceName" && target.name === "part_trail")
        );
        assert.ok(targets.some((target) => target.category === "noteResourceName" && target.name === "note_design"));
        assert.ok(
            targets.some((target) => target.category === "extensionResourceName" && target.name === "ext_physics")
        );
        assert.ok(
            targets.some((target) => target.category === "constructorFunction" && target.name === "build_widget")
        );
        assert.ok(targets.some((target) => target.category === "enum" && target.name === "state_enum"));
        assert.ok(
            targets.some(
                (target) =>
                    target.category === "enumMember" && target.name === "ready_state" && target.occurrences.length === 2
            )
        );
        assert.ok(targets.some((target) => target.category === "macro" && target.name === "DEMO_MACRO"));
        assert.ok(targets.some((target) => target.category === "globalVariable" && target.name === "global_score"));
        assert.ok(
            targets.some(
                (target) =>
                    target.category === "localVariable" && target.name === "bad_name" && target.occurrences.length === 2
            )
        );
        assert.ok(targets.some((target) => target.category === "catchArgument" && target.name === "err_value"));
    });

    void it("listNamingConventionTargets classifies constructor-backed script resources as constructorFunction targets", async () => {
        const mockProjectIndex = {
            resources: {
                "scripts/Vector3/Vector3.yy": {
                    path: "scripts/Vector3/Vector3.yy",
                    name: "Vector3",
                    resourceType: "GMScript"
                }
            },
            identifiers: {
                scripts: {
                    "scope:script:Vector3": {
                        identifierId: "script:scope:script:Vector3",
                        name: "Vector3",
                        resourcePath: "scripts/Vector3/Vector3.yy",
                        declarations: [
                            {
                                name: "Vector3",
                                filePath: "scripts/Vector3/Vector3.gml",
                                classifications: ["function", "constructor", "struct"]
                            }
                        ]
                    }
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");
        const targets = await bridge.listNamingConventionTargets();

        assert.ok(targets.some((target) => target.category === "constructorFunction" && target.name === "Vector3"));
        assert.ok(!targets.some((target) => target.category === "scriptResourceName" && target.name === "Vector3"));
    });

    void it("listNamingConventionTargets keeps plain functions in mixed multi-callable scripts out of structDeclaration fallback", async () => {
        const mockProjectIndex = {
            resources: {
                "scripts/GroupSmf/GroupSmf.yy": {
                    path: "scripts/GroupSmf/GroupSmf.yy",
                    name: "GroupSmf",
                    resourceType: "GMScript"
                }
            },
            identifiers: {
                scripts: {
                    "scope:script:group-smf": {
                        identifierId: "script:scope:script:group-smf",
                        name: "GroupSmf",
                        resourcePath: "scripts/GroupSmf/GroupSmf.yy",
                        declarationKinds: ["constructor", "struct"],
                        declarations: [
                            {
                                name: "smf_model",
                                filePath: "scripts/GroupSmf/GroupSmf.gml",
                                classifications: ["function", "constructor", "struct"]
                            },
                            {
                                name: "smf_model_load",
                                filePath: "scripts/GroupSmf/GroupSmf.gml",
                                classifications: ["function"]
                            }
                        ]
                    }
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");
        const targets = await bridge.listNamingConventionTargets();
        const constructorTarget = targets.find((target) => target.name === "smf_model");
        const functionTarget = targets.find((target) => target.name === "smf_model_load");
        const resourceTarget = targets.find((target) => target.name === "GroupSmf");

        assert.equal(constructorTarget?.category, "constructorFunction");
        assert.equal(functionTarget?.category, "function");
        assert.equal(resourceTarget?.category, "scriptResourceName");
    });

    void it("getSymbolOccurrences includes constructor parent clause references from the semantic project index", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-constructor-parent-"));

        try {
            const sourceText = [
                "function GUIElement() constructor {}",
                "function Checkbox(_name) : GUIElement() constructor {}",
                ""
            ].join("\n");

            fs.mkdirSync(path.join(tmpRoot, "scripts", "buttons"), { recursive: true });
            fs.writeFileSync(
                path.join(tmpRoot, "MyGame.yyp"),
                `${JSON.stringify({ name: "MyGame", resourceType: "GMProject" }, null, 2)}\n`
            );
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "buttons", "buttons.yy"),
                `${JSON.stringify({ name: "buttons", resourceType: "GMScript" }, null, 2)}\n`
            );
            fs.writeFileSync(path.join(tmpRoot, "scripts", "buttons", "buttons.gml"), sourceText);

            const projectIndex = await Semantic.buildProjectIndex(tmpRoot);
            const bridge = new GmlSemanticBridge(projectIndex, tmpRoot);
            const occurrences = bridge.getSymbolOccurrences("GUIElement");
            const declarationStart = sourceText.indexOf("GUIElement");
            const parentReferenceStart = sourceText.lastIndexOf("GUIElement");

            assert.equal(occurrences.length, 2);
            assert.deepEqual(
                occurrences.map((occurrence) => ({
                    kind: occurrence.kind,
                    start: occurrence.start,
                    end: occurrence.end
                })),
                [
                    {
                        kind: Refactor.OccurrenceKind.DEFINITION,
                        start: declarationStart,
                        end: declarationStart + "GUIElement".length
                    },
                    {
                        kind: Refactor.OccurrenceKind.REFERENCE,
                        start: parentReferenceStart,
                        end: parentReferenceStart + "GUIElement".length
                    }
                ]
            );
        } finally {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    void it("getSymbolOccurrences includes unresolved cross-file enum references from project file records", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-enum-cross-file-"));

        try {
            const enumSource = ["enum CM_RAY {", "    MASK,", "    NUM", "}", ""].join("\n");
            const consumerSource = [
                "function cm_aab_cast_ray(ray, mask = ray[CM_RAY.MASK]) {",
                "    return ray[CM_RAY.NUM];",
                "}",
                ""
            ].join("\n");

            fs.mkdirSync(path.join(tmpRoot, "scripts", "cm_misc"), { recursive: true });
            fs.mkdirSync(path.join(tmpRoot, "scripts", "cm_aab"), { recursive: true });
            fs.writeFileSync(
                path.join(tmpRoot, "MyGame.yyp"),
                `${JSON.stringify({ name: "MyGame", resourceType: "GMProject" }, null, 2)}\n`
            );
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "cm_misc", "cm_misc.yy"),
                `${JSON.stringify({ name: "cm_misc", resourceType: "GMScript" }, null, 2)}\n`
            );
            fs.writeFileSync(path.join(tmpRoot, "scripts", "cm_misc", "cm_misc.gml"), enumSource);
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "cm_aab", "cm_aab.yy"),
                `${JSON.stringify({ name: "cm_aab", resourceType: "GMScript" }, null, 2)}\n`
            );
            fs.writeFileSync(path.join(tmpRoot, "scripts", "cm_aab", "cm_aab.gml"), consumerSource);

            const projectIndex = await Semantic.buildProjectIndex(tmpRoot);
            const bridge = new GmlSemanticBridge(projectIndex, tmpRoot);
            const occurrences = bridge
                .getSymbolOccurrences("CM_RAY", "gml/enum/CM_RAY")
                .toSorted((left, right) => left.start - right.start);

            assert.deepEqual(
                occurrences.map((occurrence) => ({
                    kind: occurrence.kind,
                    path: occurrence.path,
                    start: occurrence.start,
                    end: occurrence.end
                })),
                [
                    {
                        kind: Refactor.OccurrenceKind.DEFINITION,
                        path: "scripts/cm_misc/cm_misc.gml",
                        start: enumSource.indexOf("CM_RAY"),
                        end: enumSource.indexOf("CM_RAY") + "CM_RAY".length
                    },
                    {
                        kind: Refactor.OccurrenceKind.REFERENCE,
                        path: "scripts/cm_aab/cm_aab.gml",
                        start: consumerSource.indexOf("CM_RAY"),
                        end: consumerSource.indexOf("CM_RAY") + "CM_RAY".length
                    },
                    {
                        kind: Refactor.OccurrenceKind.REFERENCE,
                        path: "scripts/cm_aab/cm_aab.gml",
                        start: consumerSource.lastIndexOf("CM_RAY"),
                        end: consumerSource.lastIndexOf("CM_RAY") + "CM_RAY".length
                    }
                ]
            );
        } finally {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    void it("getSymbolOccurrences preserves unresolved targetName-only project-file references", () => {
        const enumSource = ["enum CM_RAY {", "    MASK", "}", ""].join("\n");
        const consumerSource = ["return CM_RAY.MASK;", ""].join("\n");
        const declarationStart = enumSource.indexOf("CM_RAY");
        const referenceStart = consumerSource.indexOf("CM_RAY");
        const projectIndex = {
            identifiers: {
                enums: {
                    "enum:CM_RAY": {
                        identifierId: "enum:CM_RAY",
                        name: "CM_RAY",
                        declarations: [
                            {
                                name: "CM_RAY",
                                filePath: "scripts/cm_misc/cm_misc.gml",
                                start: { index: declarationStart },
                                end: { index: declarationStart + "CM_RAY".length - 1 }
                            }
                        ],
                        references: []
                    }
                }
            },
            files: {
                "scripts/cm_aab/cm_aab.gml": {
                    references: [
                        {
                            targetName: "CM_RAY",
                            classifications: ["property"],
                            start: { index: referenceStart },
                            end: { index: referenceStart + "CM_RAY".length - 1 }
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(projectIndex, "/tmp");
        const occurrences = bridge
            .getSymbolOccurrences("CM_RAY", "gml/enum/CM_RAY")
            .toSorted((left, right) => left.start - right.start);

        assert.deepEqual(
            occurrences.map((occurrence) => ({
                kind: occurrence.kind,
                path: occurrence.path,
                start: occurrence.start,
                end: occurrence.end
            })),
            [
                {
                    kind: Refactor.OccurrenceKind.DEFINITION,
                    path: "scripts/cm_misc/cm_misc.gml",
                    start: declarationStart,
                    end: declarationStart + "CM_RAY".length
                },
                {
                    kind: Refactor.OccurrenceKind.REFERENCE,
                    path: "scripts/cm_aab/cm_aab.gml",
                    start: referenceStart,
                    end: referenceStart + "CM_RAY".length
                }
            ]
        );
    });

    void it("getSymbolOccurrences for script resources ignores same-name macro occurrences", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-script-macro-"));

        try {
            const macroSource = ["#macro CM_TRIANGLE_GET_CAPSULE_REF var refX = X;\\", "var refY = Y;", ""].join("\n");
            const consumerSource = [
                "function consumer() {",
                "    CM_TRIANGLE_GET_CAPSULE_REF;",
                "    return refX + refY;",
                "}",
                ""
            ].join("\n");

            fs.mkdirSync(path.join(tmpRoot, "scripts", "CM_TRIANGLE_GET_CAPSULE_REF"), { recursive: true });
            fs.mkdirSync(path.join(tmpRoot, "scripts", "consumer"), { recursive: true });
            fs.writeFileSync(
                path.join(tmpRoot, "MyGame.yyp"),
                `${JSON.stringify({ name: "MyGame", resourceType: "GMProject" }, null, 2)}\n`
            );
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "CM_TRIANGLE_GET_CAPSULE_REF", "CM_TRIANGLE_GET_CAPSULE_REF.yy"),
                `${JSON.stringify({ name: "CM_TRIANGLE_GET_CAPSULE_REF", resourceType: "GMScript" }, null, 2)}\n`
            );
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "CM_TRIANGLE_GET_CAPSULE_REF", "CM_TRIANGLE_GET_CAPSULE_REF.gml"),
                macroSource
            );
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "consumer", "consumer.yy"),
                `${JSON.stringify({ name: "consumer", resourceType: "GMScript" }, null, 2)}\n`
            );
            fs.writeFileSync(path.join(tmpRoot, "scripts", "consumer", "consumer.gml"), consumerSource);

            const projectIndex = await Semantic.buildProjectIndex(tmpRoot);
            const bridge = new GmlSemanticBridge(projectIndex, tmpRoot);
            const scriptOccurrences = bridge.getSymbolOccurrences(
                "CM_TRIANGLE_GET_CAPSULE_REF",
                "gml/scripts/CM_TRIANGLE_GET_CAPSULE_REF"
            );
            const macroOccurrences = bridge.getSymbolOccurrences(
                "CM_TRIANGLE_GET_CAPSULE_REF",
                "gml/macro/CM_TRIANGLE_GET_CAPSULE_REF"
            );

            assert.deepEqual(scriptOccurrences, []);
            assert.deepEqual(
                macroOccurrences.map((occurrence) => ({
                    kind: occurrence.kind,
                    path: occurrence.path
                })),
                [
                    {
                        kind: Refactor.OccurrenceKind.DEFINITION,
                        path: "scripts/CM_TRIANGLE_GET_CAPSULE_REF/CM_TRIANGLE_GET_CAPSULE_REF.gml"
                    },
                    {
                        kind: Refactor.OccurrenceKind.REFERENCE,
                        path: "scripts/consumer/consumer.gml"
                    }
                ]
            );
        } finally {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    void it("listNamingConventionTargets includes unresolved cross-file enum member references", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-enum-member-cross-file-"));

        try {
            const enumSource = ["enum INPUT_VIRTUAL_TYPE {", "    DPAD_4DIR,", "    DPAD_8DIR", "}", ""].join("\n");
            const consumerSource = [
                "function demo() {",
                "    return [INPUT_VIRTUAL_TYPE.DPAD_4DIR, INPUT_VIRTUAL_TYPE.DPAD_8DIR];",
                "}",
                ""
            ].join("\n");

            fs.mkdirSync(path.join(tmpRoot, "scripts", "defs"), { recursive: true });
            fs.mkdirSync(path.join(tmpRoot, "scripts", "use"), { recursive: true });
            fs.writeFileSync(
                path.join(tmpRoot, "MyGame.yyp"),
                `${JSON.stringify({ name: "MyGame", resourceType: "GMProject" }, null, 2)}\n`
            );
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "defs", "defs.yy"),
                `${JSON.stringify({ name: "defs", resourceType: "GMScript" }, null, 2)}\n`
            );
            fs.writeFileSync(path.join(tmpRoot, "scripts", "defs", "defs.gml"), enumSource);
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "use", "use.yy"),
                `${JSON.stringify({ name: "use", resourceType: "GMScript" }, null, 2)}\n`
            );
            fs.writeFileSync(path.join(tmpRoot, "scripts", "use", "use.gml"), consumerSource);

            const projectIndex = await Semantic.buildProjectIndex(tmpRoot);
            const bridge = new GmlSemanticBridge(projectIndex, tmpRoot);
            const targets = await bridge.listNamingConventionTargets();
            const dpadTarget = targets.find(
                (target) => target.category === "enumMember" && target.name === "DPAD_4DIR"
            );

            assert.ok(dpadTarget);
            assert.deepEqual(
                dpadTarget?.occurrences.map((occurrence) => ({
                    kind: occurrence.kind,
                    path: occurrence.path
                })),
                [
                    {
                        kind: Refactor.OccurrenceKind.DEFINITION,
                        path: "scripts/defs/defs.gml"
                    },
                    {
                        kind: Refactor.OccurrenceKind.REFERENCE,
                        path: "scripts/use/use.gml"
                    }
                ]
            );
        } finally {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    void it("listNamingConventionTargets includes unresolved dotted references for unique constructor static members", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-struct-static-member-"));

        try {
            const vectorSource = [
                "function Vector2(x, y) constructor {",
                "    static Sub = function(val) {",
                "        return new Vector2(x - val.x, y - val.y);",
                "    };",
                "}",
                ""
            ].join("\n");
            const consumerSource = [
                "function move_step(pos, prev_pos) {",
                "    return pos.Sub(prev_pos);",
                "}",
                ""
            ].join("\n");

            fs.mkdirSync(path.join(tmpRoot, "scripts", "vec"), { recursive: true });
            fs.mkdirSync(path.join(tmpRoot, "scripts", "move_step"), { recursive: true });
            fs.writeFileSync(
                path.join(tmpRoot, "MyGame.yyp"),
                `${JSON.stringify({ name: "MyGame", resourceType: "GMProject" }, null, 2)}\n`
            );
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "vec", "vec.yy"),
                `${JSON.stringify({ name: "vec", resourceType: "GMScript" }, null, 2)}\n`
            );
            fs.writeFileSync(path.join(tmpRoot, "scripts", "vec", "vec.gml"), vectorSource);
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "move_step", "move_step.yy"),
                `${JSON.stringify({ name: "move_step", resourceType: "GMScript" }, null, 2)}\n`
            );
            fs.writeFileSync(path.join(tmpRoot, "scripts", "move_step", "move_step.gml"), consumerSource);

            const projectIndex = await Semantic.buildProjectIndex(tmpRoot);
            const bridge = new GmlSemanticBridge(projectIndex, tmpRoot);
            const targets = await bridge.listNamingConventionTargets();
            const subTarget = targets.find((target) => target.category === "staticVariable" && target.name === "Sub");

            assert.ok(subTarget);
            assert.deepEqual(
                subTarget?.occurrences.map((occurrence) => ({
                    kind: occurrence.kind,
                    path: occurrence.path
                })),
                [
                    {
                        kind: Refactor.OccurrenceKind.DEFINITION,
                        path: "scripts/vec/vec.gml"
                    },
                    {
                        kind: Refactor.OccurrenceKind.REFERENCE,
                        path: "scripts/move_step/move_step.gml"
                    }
                ]
            );
        } finally {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    void it("listNamingConventionTargets includes unresolved bare calls for unique constructor static members", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-static-member-bare-call-"));

        try {
            const stateSource = [
                "function generator_state() {",
                "    static _struct = new GeneratorState();",
                "    return _struct;",
                "}",
                "",
                "function GeneratorState() constructor {",
                "    Reset();",
                "",
                "    static Reset = function() {",
                "        return 1;",
                "    };",
                "}",
                ""
            ].join("\n");
            const consumerSource = [
                "function initialize() {",
                "    static _generator_state = generator_state();",
                "    with (_generator_state) {",
                "        Reset();",
                "    }",
                "}",
                ""
            ].join("\n");

            fs.mkdirSync(path.join(tmpRoot, "scripts", "generator_state"), { recursive: true });
            fs.mkdirSync(path.join(tmpRoot, "scripts", "initialize"), { recursive: true });
            fs.writeFileSync(
                path.join(tmpRoot, "MyGame.yyp"),
                `${JSON.stringify({ name: "MyGame", resourceType: "GMProject" }, null, 2)}\n`
            );
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "generator_state", "generator_state.yy"),
                `${JSON.stringify({ name: "generator_state", resourceType: "GMScript" }, null, 2)}\n`
            );
            fs.writeFileSync(path.join(tmpRoot, "scripts", "generator_state", "generator_state.gml"), stateSource);
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "initialize", "initialize.yy"),
                `${JSON.stringify({ name: "initialize", resourceType: "GMScript" }, null, 2)}\n`
            );
            fs.writeFileSync(path.join(tmpRoot, "scripts", "initialize", "initialize.gml"), consumerSource);

            const projectIndex = await Semantic.buildProjectIndex(tmpRoot);
            const bridge = new GmlSemanticBridge(projectIndex, tmpRoot);
            const targets = await bridge.listNamingConventionTargets();
            const resetTarget = targets.find(
                (target) => target.category === "staticVariable" && target.name === "Reset"
            );

            assert.ok(resetTarget);
            // Sort by kind then path to ensure stable comparison regardless of traversal order.
            const sortedOccurrences = resetTarget.occurrences
                .map((occurrence) => ({ kind: occurrence.kind, path: occurrence.path }))
                .sort((a, b) => `${a.kind}\0${a.path}`.localeCompare(`${b.kind}\0${b.path}`));
            assert.deepEqual(sortedOccurrences, [
                {
                    kind: Refactor.OccurrenceKind.DEFINITION,
                    path: "scripts/generator_state/generator_state.gml"
                },
                {
                    kind: Refactor.OccurrenceKind.REFERENCE,
                    path: "scripts/generator_state/generator_state.gml"
                },
                {
                    kind: Refactor.OccurrenceKind.REFERENCE,
                    path: "scripts/initialize/initialize.gml"
                }
            ]);
        } finally {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    void it("listNamingConventionTargets excludes ambiguous constructor static members with unresolved references", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-static-member-ambiguous-"));

        try {
            const class1Source = [
                "function Vector2() constructor {",
                "    static Add = function(val) { return 2; };",
                "}",
                ""
            ].join("\n");

            const class2Source = [
                "function Vector3() constructor {",
                "    static Add = function(val) { return 3; };",
                "}",
                ""
            ].join("\n");

            const consumerSource = ["function update(pos) {", "    return pos.Add(1);", "}", ""].join("\n");

            fs.mkdirSync(path.join(tmpRoot, "scripts", "classes"), { recursive: true });
            fs.mkdirSync(path.join(tmpRoot, "scripts", "consumer"), { recursive: true });
            fs.writeFileSync(
                path.join(tmpRoot, "MyGame.yyp"),
                `${JSON.stringify({ name: "MyGame", resourceType: "GMProject" }, null, 2)}\n`
            );
            fs.writeFileSync(path.join(tmpRoot, "scripts", "classes", "classes.gml"), class1Source + class2Source);
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "classes", "classes.yy"),
                `${JSON.stringify({ name: "classes", resourceType: "GMScript" }, null, 2)}\n`
            );
            fs.writeFileSync(path.join(tmpRoot, "scripts", "consumer", "consumer.gml"), consumerSource);
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "consumer", "consumer.yy"),
                `${JSON.stringify({ name: "consumer", resourceType: "GMScript" }, null, 2)}\n`
            );

            const projectIndex = await Semantic.buildProjectIndex(tmpRoot);
            const bridge = new GmlSemanticBridge(projectIndex, tmpRoot);
            const targets = await bridge.listNamingConventionTargets();

            const addTargets = targets.filter(
                (target) => target.category === "staticVariable" && target.name === "Add"
            );

            assert.strictEqual(
                addTargets.length,
                0,
                "Should abort yielding static variable targets for ambiguous occurrences"
            );
        } finally {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    void it("listMacroExpansionDependencies reports caller-scoped identifiers consumed by referenced macros", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-macro-deps-"));

        try {
            fs.mkdirSync(path.join(tmpRoot, "scripts", "cm_triangle_get_capsule_ref"), { recursive: true });
            fs.mkdirSync(path.join(tmpRoot, "scripts", "cm_triangle"), { recursive: true });
            fs.writeFileSync(
                path.join(tmpRoot, "MyGame.yyp"),
                `${JSON.stringify({ name: "MyGame", resourceType: "GMProject" }, null, 2)}\n`
            );
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "cm_triangle_get_capsule_ref", "cm_triangle_get_capsule_ref.yy"),
                `${JSON.stringify({ name: "cm_triangle_get_capsule_ref", resourceType: "GMScript" }, null, 2)}\n`
            );
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "cm_triangle_get_capsule_ref", "cm_triangle_get_capsule_ref.gml"),
                ["#macro CM_TRIANGLE_GET_CAPSULE_REF var refZ = Z + zup;\\", "var refX = X + xup;", ""].join("\n")
            );
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "cm_triangle", "cm_triangle.yy"),
                `${JSON.stringify({ name: "cm_triangle", resourceType: "GMScript" }, null, 2)}\n`
            );
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "cm_triangle", "cm_triangle.gml"),
                [
                    "function cm_triangle(collider) {",
                    "    var X = collider[0];",
                    "    var Z = collider[1];",
                    "    var zup = collider[2];",
                    "    var xup = collider[3];",
                    "    CM_TRIANGLE_GET_CAPSULE_REF;",
                    "    return refX + refZ;",
                    "}",
                    ""
                ].join("\n")
            );

            const projectIndex = await Semantic.buildProjectIndex(tmpRoot);
            const bridge = new GmlSemanticBridge(projectIndex, tmpRoot);
            const dependencies = bridge.listMacroExpansionDependencies(["scripts/cm_triangle/cm_triangle.gml"]);

            assert.deepEqual(dependencies, [
                {
                    path: "scripts/cm_triangle/cm_triangle.gml",
                    macroName: "CM_TRIANGLE_GET_CAPSULE_REF",
                    referencedNames: ["Z", "xup", "zup"]
                }
            ]);
        } finally {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    void it("getSymbolOccurrences includes enum references embedded in macro declaration bodies", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-macro-occurrences-"));

        try {
            fs.mkdirSync(path.join(tmpRoot, "scripts", "input_defs"), { recursive: true });
            fs.mkdirSync(path.join(tmpRoot, "scripts", "input_config"), { recursive: true });
            fs.writeFileSync(
                path.join(tmpRoot, "MyGame.yyp"),
                `${JSON.stringify({ name: "MyGame", resourceType: "GMProject" }, null, 2)}\n`
            );
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "input_defs", "input_defs.yy"),
                `${JSON.stringify({ name: "input_defs", resourceType: "GMScript" }, null, 2)}\n`
            );
            const enumSource = ["enum INPUT_SOURCE_MODE {", "    HOTSWAP", "}", ""].join("\n");
            fs.writeFileSync(path.join(tmpRoot, "scripts", "input_defs", "input_defs.gml"), enumSource);
            fs.writeFileSync(
                path.join(tmpRoot, "scripts", "input_config", "input_config.yy"),
                `${JSON.stringify({ name: "input_config", resourceType: "GMScript" }, null, 2)}\n`
            );
            const macroSource = [
                "#macro INPUT_STARTING_SOURCE_MODE  INPUT_SOURCE_MODE.HOTSWAP",
                "function input_config() {",
                "    return INPUT_STARTING_SOURCE_MODE;",
                "}",
                ""
            ].join("\n");
            fs.writeFileSync(path.join(tmpRoot, "scripts", "input_config", "input_config.gml"), macroSource);

            const projectIndex = await Semantic.buildProjectIndex(tmpRoot);
            const bridge = new GmlSemanticBridge(projectIndex, tmpRoot);
            const occurrences = bridge.getSymbolOccurrences("INPUT_SOURCE_MODE", "gml/enum/INPUT_SOURCE_MODE");
            const macroReferenceStart = macroSource.indexOf("INPUT_SOURCE_MODE.HOTSWAP");

            assert.ok(
                occurrences.some(
                    (occurrence) =>
                        occurrence.path === "scripts/input_config/input_config.gml" &&
                        occurrence.start === macroReferenceStart &&
                        occurrence.end === macroReferenceStart + "INPUT_SOURCE_MODE".length &&
                        occurrence.kind === Refactor.OccurrenceKind.REFERENCE
                ),
                "expected macro body enum reference to be reported as an occurrence"
            );
        } finally {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    void it("listNamingConventionTargets keeps same-name callables independent for multi-function script resources", async () => {
        const mockProjectIndex = {
            resources: {
                "scripts/DemoLibrary/DemoLibrary.yy": {
                    path: "scripts/DemoLibrary/DemoLibrary.yy",
                    name: "DemoLibrary",
                    resourceType: "GMScript"
                }
            },
            identifiers: {
                scripts: {
                    "scope:script:DemoLibrary": {
                        identifierId: "script:scope:script:DemoLibrary",
                        name: "DemoLibrary",
                        resourcePath: "scripts/DemoLibrary/DemoLibrary.yy",
                        declarations: [
                            {
                                name: "DemoLibrary",
                                filePath: "scripts/DemoLibrary/DemoLibrary.gml",
                                classifications: ["function"]
                            },
                            {
                                name: "helper_fn",
                                filePath: "scripts/DemoLibrary/DemoLibrary.gml",
                                classifications: ["function"]
                            }
                        ]
                    }
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");
        const targets = await bridge.listNamingConventionTargets();

        assert.ok(targets.some((target) => target.category === "scriptResourceName" && target.name === "DemoLibrary"));
        assert.ok(targets.some((target) => target.category === "function" && target.name === "DemoLibrary"));
        assert.ok(targets.some((target) => target.category === "function" && target.name === "helper_fn"));
    });

    void it("getSymbolOccurrences keeps multi-function script resource renames independent from same-name callables", () => {
        const mockProjectIndex = {
            resources: {
                "scripts/DemoLibrary/DemoLibrary.yy": {
                    path: "scripts/DemoLibrary/DemoLibrary.yy",
                    name: "DemoLibrary",
                    resourceType: "GMScript"
                }
            },
            identifiers: {
                scripts: {
                    "scope:script:DemoLibrary": {
                        identifierId: "script:scope:script:DemoLibrary",
                        name: "DemoLibrary",
                        resourcePath: "scripts/DemoLibrary/DemoLibrary.yy",
                        declarations: [
                            {
                                name: "DemoLibrary",
                                filePath: "scripts/DemoLibrary/DemoLibrary.gml",
                                start: { index: 9 },
                                end: { index: 20 }
                            },
                            {
                                name: "helper_fn",
                                filePath: "scripts/DemoLibrary/DemoLibrary.gml",
                                start: { index: 45 },
                                end: { index: 54 }
                            }
                        ],
                        references: [
                            {
                                filePath: "scripts/consumer_script/consumer_script.gml",
                                targetName: "DemoLibrary",
                                start: { index: 40 },
                                end: { index: 51 }
                            },
                            {
                                filePath: "scripts/consumer_script/consumer_script.gml",
                                targetName: "helper_fn",
                                start: { index: 55 },
                                end: { index: 64 }
                            }
                        ]
                    }
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");
        const resourceOccurrences = bridge.getSymbolOccurrences("DemoLibrary", "gml/scripts/DemoLibrary");
        const callableOccurrences = bridge.getSymbolOccurrences("DemoLibrary", "gml/script/DemoLibrary");

        assert.deepEqual(
            resourceOccurrences,
            [],
            "Resource renames for multi-function scripts should not reuse callable text occurrences"
        );
        assert.equal(callableOccurrences.length, 2);
        assert.deepEqual(
            callableOccurrences.map((occurrence) => occurrence.path),
            ["scripts/DemoLibrary/DemoLibrary.gml", "scripts/consumer_script/consumer_script.gml"]
        );
    });

    void it("listNamingConventionTargets refines local variables into static and loop-index categories", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-local-categories-"));
        const relativeFilePath = "scripts/demo_script/demo_script.gml";
        const absoluteFilePath = path.join(tmpRoot, relativeFilePath);
        const sourceText = [
            "function demo_script() {",
            "    static cache_value = 0;",
            "    cache_value += 1;",
            "    var local_value = 1;",
            "    for (var loop_index = 0; loop_index < 3; loop_index += 1) {",
            "        local_value += loop_index;",
            "    }",
            "}",
            ""
        ].join("\n");

        fs.mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
        fs.writeFileSync(absoluteFilePath, sourceText, "utf8");

        const cacheDeclarationStart = findNthIndex(sourceText, "cache_value", 1);
        const cacheReferenceStart = findNthIndex(sourceText, "cache_value", 2);
        const localDeclarationStart = findNthIndex(sourceText, "local_value", 1);
        const localReferenceStart = findNthIndex(sourceText, "local_value", 2);
        const loopDeclarationStart = findNthIndex(sourceText, "loop_index", 1);
        const loopConditionReferenceStart = findNthIndex(sourceText, "loop_index", 2);
        const loopUpdateReferenceStart = findNthIndex(sourceText, "loop_index", 3);
        const loopBodyReferenceStart = findNthIndex(sourceText, "loop_index", 4);

        const mockProjectIndex = {
            identifiers: {
                instanceVariables: {}
            },
            files: {
                [relativeFilePath]: {
                    declarations: [
                        {
                            name: "cache_value",
                            scopeId: "scope:function",
                            classifications: ["variable"],
                            start: { index: cacheDeclarationStart },
                            end: { index: cacheDeclarationStart + "cache_value".length }
                        },
                        {
                            name: "local_value",
                            scopeId: "scope:function",
                            classifications: ["variable"],
                            start: { index: localDeclarationStart },
                            end: { index: localDeclarationStart + "local_value".length }
                        },
                        {
                            name: "loop_index",
                            scopeId: "scope:function",
                            classifications: ["variable"],
                            start: { index: loopDeclarationStart },
                            end: { index: loopDeclarationStart + "loop_index".length }
                        }
                    ],
                    references: [
                        {
                            name: "cache_value",
                            scopeId: "scope:function",
                            start: { index: cacheReferenceStart },
                            end: { index: cacheReferenceStart + "cache_value".length },
                            declaration: {
                                name: "cache_value",
                                scopeId: "scope:function",
                                start: { index: cacheDeclarationStart }
                            }
                        },
                        {
                            name: "local_value",
                            scopeId: "scope:function",
                            start: { index: localReferenceStart },
                            end: { index: localReferenceStart + "local_value".length },
                            declaration: {
                                name: "local_value",
                                scopeId: "scope:function",
                                start: { index: localDeclarationStart }
                            }
                        },
                        {
                            name: "loop_index",
                            scopeId: "scope:function",
                            start: { index: loopConditionReferenceStart },
                            end: { index: loopConditionReferenceStart + "loop_index".length },
                            declaration: {
                                name: "loop_index",
                                scopeId: "scope:function",
                                start: { index: loopDeclarationStart }
                            }
                        },
                        {
                            name: "loop_index",
                            scopeId: "scope:function",
                            start: { index: loopUpdateReferenceStart },
                            end: { index: loopUpdateReferenceStart + "loop_index".length },
                            declaration: {
                                name: "loop_index",
                                scopeId: "scope:function",
                                start: { index: loopDeclarationStart }
                            }
                        },
                        {
                            name: "loop_index",
                            scopeId: "scope:function",
                            start: { index: loopBodyReferenceStart },
                            end: { index: loopBodyReferenceStart + "loop_index".length },
                            declaration: {
                                name: "loop_index",
                                scopeId: "scope:function",
                                start: { index: loopDeclarationStart }
                            }
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const targets = await bridge.listNamingConventionTargets();

        assert.ok(
            targets.some(
                (target) =>
                    target.category === "staticVariable" &&
                    target.name === "cache_value" &&
                    target.occurrences.length === 2
            )
        );
        assert.ok(
            targets.some(
                (target) =>
                    target.category === "localVariable" &&
                    target.name === "local_value" &&
                    target.occurrences.length === 2
            )
        );
        assert.ok(
            targets.some(
                (target) =>
                    target.category === "loopIndexVariable" &&
                    target.name === "loop_index" &&
                    target.occurrences.length === 4
            )
        );
    });

    void it("listNamingConventionTargets synthesizes implicit instance-variable targets from object assignments", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-instance-targets-"));
        const relativeFilePath = "objects/oActorParent/Create_0.gml";
        const absoluteFilePath = path.join(tmpRoot, relativeFilePath);
        const sourceText = [
            "charMat = matrix_build_identity();",
            "var turnSpd = move_spd * 0.4;",
            "charMat[0] += turnSpd;",
            ""
        ].join("\n");

        fs.mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
        fs.writeFileSync(absoluteFilePath, sourceText, "utf8");

        const charMatDefinitionStart = findNthIndex(sourceText, "charMat", 1);
        const charMatReferenceStart = findNthIndex(sourceText, "charMat", 2);

        const mockProjectIndex = {
            identifiers: {
                instanceVariables: {}
            },
            files: {
                [relativeFilePath]: {
                    declarations: [],
                    references: [
                        {
                            name: "charMat",
                            scopeId: "scope:object:oActorParent",
                            start: { index: charMatDefinitionStart },
                            end: { index: charMatDefinitionStart + "charMat".length - 1 },
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        },
                        {
                            name: "charMat",
                            scopeId: "scope:object:oActorParent",
                            start: { index: charMatReferenceStart },
                            end: { index: charMatReferenceStart + "charMat".length - 1 },
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const targets = await bridge.listNamingConventionTargets([relativeFilePath]);
        const charMatTarget = targets.find(
            (target) => target.category === "instanceVariable" && target.name === "charMat"
        );

        assert.ok(charMatTarget);
        assert.equal(charMatTarget?.path, relativeFilePath);
        assert.equal(charMatTarget?.scopeId, "objects/oActorParent");
        assert.equal(charMatTarget?.symbolId, null);
        assert.equal(charMatTarget?.occurrences.length, 2);
        assert.equal(charMatTarget?.occurrences[0]?.kind, "definition");
    });

    void it("listNamingConventionTargets synthesizes implicit instance-variable targets for numeric semantic scope ids", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-instance-targets-numeric-scope-"));
        const relativeFilePath = "objects/obj_spider/Create_0.gml";
        const absoluteFilePath = path.join(tmpRoot, relativeFilePath);
        const sourceText = ["armTarget = [];", "armPos[0] = armTarget[0];", ""].join("\n");

        fs.mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
        fs.writeFileSync(absoluteFilePath, sourceText, "utf8");

        const armTargetDefinitionStart = findNthIndex(sourceText, "armTarget", 1);
        const armPosDefinitionStart = findNthIndex(sourceText, "armPos", 1);
        const armTargetReferenceStart = findNthIndex(sourceText, "armTarget", 2);

        const mockProjectIndex = {
            identifiers: {
                instanceVariables: {}
            },
            files: {
                [relativeFilePath]: {
                    declarations: [],
                    references: [
                        {
                            name: "armTarget",
                            scopeId: "scope-0",
                            start: { index: armTargetDefinitionStart },
                            end: { index: armTargetDefinitionStart + "armTarget".length - 1 },
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        },
                        {
                            name: "armPos",
                            scopeId: "scope-0",
                            start: { index: armPosDefinitionStart },
                            end: { index: armPosDefinitionStart + "armPos".length - 1 },
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        },
                        {
                            name: "armTarget",
                            scopeId: "scope-0",
                            start: { index: armTargetReferenceStart },
                            end: { index: armTargetReferenceStart + "armTarget".length - 1 },
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const targets = await bridge.listNamingConventionTargets([relativeFilePath]);
        const armTargetTarget = targets.find(
            (target) => target.category === "instanceVariable" && target.name === "armTarget"
        );
        const armPosTarget = targets.find(
            (target) => target.category === "instanceVariable" && target.name === "armPos"
        );

        assert.ok(armTargetTarget);
        assert.equal(armTargetTarget?.path, relativeFilePath);
        assert.equal(armTargetTarget?.scopeId, "objects/obj_spider");
        assert.equal(armTargetTarget?.occurrences.length, 2);
        assert.equal(armTargetTarget?.occurrences[0]?.kind, "definition");

        assert.ok(armPosTarget);
        assert.equal(armPosTarget?.path, relativeFilePath);
        assert.equal(armPosTarget?.scopeId, "objects/obj_spider");
        assert.equal(armPosTarget?.occurrences.length, 1);
        assert.equal(armPosTarget?.occurrences[0]?.kind, "definition");
    });

    void it("listNamingConventionTargets widens implicit instance-variable targets across inherited and dotted object references", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-instance-targets-wide-"));
        const parentFilePath = "objects/oActorParent/Create_0.gml";
        const childFilePath = "objects/oPlayer/Create_0.gml";
        const cameraFilePath = "objects/oCamera/Create_0.gml";
        const parentSource = ["upDir = new Vector3(0, 0, 1);", ""].join("\n");
        const childSource = ["event_inherited();", "basis = { up: upDir };", "show_debug_message(upDir);", ""].join(
            "\n"
        );
        const cameraSource = ["follow_id = oPlayer;", "show_debug_message(follow_id.upDir);", ""].join("\n");

        fs.mkdirSync(path.join(tmpRoot, "objects", "oActorParent"), { recursive: true });
        fs.mkdirSync(path.join(tmpRoot, "objects", "oPlayer"), { recursive: true });
        fs.mkdirSync(path.join(tmpRoot, "objects", "oCamera"), { recursive: true });
        fs.writeFileSync(path.join(tmpRoot, parentFilePath), parentSource, "utf8");
        fs.writeFileSync(path.join(tmpRoot, childFilePath), childSource, "utf8");
        fs.writeFileSync(path.join(tmpRoot, cameraFilePath), cameraSource, "utf8");

        const parentDefinitionStart = findNthIndex(parentSource, "upDir", 1);
        const childPropertyReferenceStart = findNthIndex(childSource, "upDir", 1);
        const childBareReferenceStart = findNthIndex(childSource, "upDir", 2);
        const dottedReferenceStart = findNthIndex(cameraSource, "upDir", 1);

        const mockProjectIndex = {
            identifiers: {
                instanceVariables: {}
            },
            files: {
                [parentFilePath]: {
                    declarations: [],
                    references: [
                        {
                            name: "upDir",
                            scopeId: "scope:object:oActorParent",
                            start: { index: parentDefinitionStart },
                            end: { index: parentDefinitionStart + "upDir".length - 1 },
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        }
                    ]
                },
                [childFilePath]: {
                    declarations: [],
                    references: [
                        {
                            name: "upDir",
                            scopeId: "scope:object:oPlayer",
                            start: { index: childPropertyReferenceStart },
                            end: { index: childPropertyReferenceStart + "upDir".length - 1 },
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        },
                        {
                            name: "upDir",
                            scopeId: "scope:object:oPlayer",
                            start: { index: childBareReferenceStart },
                            end: { index: childBareReferenceStart + "upDir".length - 1 },
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        }
                    ]
                },
                [cameraFilePath]: {
                    declarations: [],
                    references: [
                        {
                            name: "upDir",
                            scopeId: "scope:object:oCamera",
                            start: { index: dottedReferenceStart },
                            end: { index: dottedReferenceStart + "upDir".length - 1 },
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const targets = await bridge.listNamingConventionTargets([parentFilePath, childFilePath, cameraFilePath]);
        const upDirTarget = targets.find((target) => target.category === "instanceVariable" && target.name === "upDir");

        assert.ok(upDirTarget);
        assert.equal(upDirTarget?.path, parentFilePath);
        assert.equal(upDirTarget?.scopeId, "objects/oActorParent");
        assert.equal(upDirTarget?.occurrences.length, 4);
        assert.deepEqual(
            upDirTarget?.occurrences.map((occurrence) => `${occurrence.kind}:${occurrence.path}`).toSorted(),
            [
                `definition:${parentFilePath}`,
                `reference:${cameraFilePath}`,
                `reference:${childFilePath}`,
                `reference:${childFilePath}`
            ].toSorted()
        );
    });

    void it("listNamingConventionTargets does not synthesize implicit instance-variable targets for known resource identifiers", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-resource-name-targets-"));
        const systemFilePath = "objects/oSystem/Other_2.gml";
        const playerFilePath = "objects/oPlayer/Create_0.gml";
        const systemSource = ["instance_create_depth(0, 0, 0, oCamera);", "if (instance_exists(oCamera)) {}", ""].join(
            "\n"
        );
        const playerSource = [
            "if (instance_exists(oCamera)) {",
            "    show_debug_message(oCamera.camXfrom);",
            "}",
            ""
        ].join("\n");

        fs.mkdirSync(path.join(tmpRoot, "objects", "oSystem"), { recursive: true });
        fs.mkdirSync(path.join(tmpRoot, "objects", "oPlayer"), { recursive: true });
        fs.writeFileSync(path.join(tmpRoot, systemFilePath), systemSource, "utf8");
        fs.writeFileSync(path.join(tmpRoot, playerFilePath), playerSource, "utf8");

        const systemCreateDepthStart = findNthIndex(systemSource, "oCamera", 1);
        const systemInstanceExistsStart = findNthIndex(systemSource, "oCamera", 2);
        const playerInstanceExistsStart = findNthIndex(playerSource, "oCamera", 1);
        const playerDottedOwnerStart = findNthIndex(playerSource, "oCamera", 2);

        const mockProjectIndex = {
            identifiers: {
                instanceVariables: {}
            },
            resources: {
                "objects/oCamera/oCamera.yy": {
                    path: "objects/oCamera/oCamera.yy",
                    name: "oCamera",
                    resourceType: "GMObject",
                    assetReferences: []
                }
            },
            files: {
                [systemFilePath]: {
                    declarations: [],
                    references: [
                        {
                            name: "oCamera",
                            scopeId: "scope:object:oSystem",
                            start: { index: systemCreateDepthStart },
                            end: { index: systemCreateDepthStart + "oCamera".length - 1 },
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        },
                        {
                            name: "oCamera",
                            scopeId: "scope:object:oSystem",
                            start: { index: systemInstanceExistsStart },
                            end: { index: systemInstanceExistsStart + "oCamera".length - 1 },
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        }
                    ]
                },
                [playerFilePath]: {
                    declarations: [],
                    references: [
                        {
                            name: "oCamera",
                            scopeId: "scope:object:oPlayer",
                            start: { index: playerInstanceExistsStart },
                            end: { index: playerInstanceExistsStart + "oCamera".length - 1 },
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        },
                        {
                            name: "oCamera",
                            scopeId: "scope:object:oPlayer",
                            start: { index: playerDottedOwnerStart },
                            end: { index: playerDottedOwnerStart + "oCamera".length - 1 },
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const targets = await bridge.listNamingConventionTargets([systemFilePath, playerFilePath]);

        assert.ok(!targets.some((target) => target.category === "instanceVariable" && target.name === "oCamera"));
    });

    void it("listNamingConventionTargets excludes enum-member property references from implicit instance-variable targets", async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-implicit-enum-members-"));
        const enumFilePath = "scripts/cm_misc/cm_misc.gml";
        const objectFilePath = "objects/oPlayer/Draw_73.gml";
        const enumSource = ["enum CM {", "    R,", "    NUM", "}", ""].join("\n");
        const objectSource = ["R = 1;", "show_debug_message(R);", "show_debug_message(collider[CM.R]);", ""].join("\n");

        fs.mkdirSync(path.join(tmpRoot, "scripts", "cm_misc"), { recursive: true });
        fs.writeFileSync(path.join(tmpRoot, enumFilePath), enumSource, "utf8");
        fs.mkdirSync(path.join(tmpRoot, "objects", "oPlayer"), { recursive: true });
        fs.writeFileSync(path.join(tmpRoot, objectFilePath), objectSource, "utf8");

        const definitionStart = objectSource.indexOf("R =");
        const bareReferenceStart = objectSource.indexOf("R);");
        const enumMemberReferenceStart = objectSource.indexOf("CM.R") + "CM.".length;

        const mockProjectIndex = {
            identifiers: {
                enums: {
                    "enum:CM": {
                        name: "CM",
                        declarations: [
                            {
                                name: "CM",
                                filePath: enumFilePath,
                                start: { index: enumSource.indexOf("CM") },
                                end: { index: enumSource.indexOf("CM") + "CM".length - 1 }
                            }
                        ]
                    }
                }
            },
            files: {
                [objectFilePath]: {
                    declarations: [],
                    references: [
                        {
                            name: "R",
                            scopeId: "scope:object:oPlayer",
                            start: { index: definitionStart },
                            end: { index: definitionStart + "R".length - 1 },
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        },
                        {
                            name: "R",
                            scopeId: "scope:object:oPlayer",
                            start: { index: bareReferenceStart },
                            end: { index: bareReferenceStart + "R".length - 1 },
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        },
                        {
                            name: "R",
                            scopeId: "scope:object:oPlayer",
                            classifications: ["property"],
                            start: { index: enumMemberReferenceStart },
                            end: { index: enumMemberReferenceStart + "R".length - 1 },
                            declaration: null,
                            isBuiltIn: false,
                            isGlobalIdentifier: false
                        }
                    ]
                }
            }
        };

        const bridge = new GmlSemanticBridge(mockProjectIndex, tmpRoot);
        const targets = await bridge.listNamingConventionTargets([enumFilePath, objectFilePath]);
        const rTarget = targets.find((target) => target.category === "instanceVariable" && target.name === "R");

        assert.ok(rTarget);
        assert.deepEqual(
            rTarget?.occurrences.map((occurrence) => occurrence.start),
            [definitionStart, bareReferenceStart]
        );
    });

    void it("collectImplicitInstanceVariableTargets excludes script-scope property references", () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-semantic-bridge-implicit-script-scope-"));
        const scriptFilePath = "scripts/conveniencefunctions/conveniencefunctions.gml";
        const scriptSource = "var anim = playerModel = 1;";

        try {
            fs.mkdirSync(path.join(tmpRoot, "scripts", "conveniencefunctions"), { recursive: true });
            fs.writeFileSync(path.join(tmpRoot, scriptFilePath), scriptSource, "utf8");

            const playerModelStart = scriptSource.indexOf("playerModel");

            const targets = collectImplicitInstanceVariableTargets({
                files: {
                    [scriptFilePath]: {
                        references: [
                            {
                                name: "playerModel",
                                scopeId: "scope:script:conveniencefunctions",
                                start: { index: playerModelStart },
                                end: { index: playerModelStart + "playerModel".length - 1 },
                                declaration: null,
                                classifications: ["property"],
                                isBuiltIn: false,
                                isGlobalIdentifier: false
                            }
                        ]
                    }
                },
                knownEnumNames: new Set<string>(),
                knownNamesByObjectDirectory: new Map<string, Set<string>>(),
                knownResourceNames: new Set<string>(),
                projectRoot: tmpRoot,
                shouldIncludePath: () => true
            });

            assert.equal(
                targets.find((target) => target.name === "playerModel"),
                undefined,
                "script-scope property should not be collected as an implicit instance-variable target"
            );
        } finally {
            fs.rmSync(tmpRoot, { force: true, recursive: true });
        }
    });

    void it("shouldCollectUnresolvedProjectFileReferences correctly authorizes collection of instance variables", () => {
        const mockProjectIndex = {};
        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");
        // Verify symbol ID handling
        assert.equal(
            (bridge as any).shouldCollectUnresolvedProjectFileReferences(
                { identifierId: "instance:sub" },
                "gml/var/sub"
            ),
            true
        );
    });

    void it("isConstructorStaticMemberDeclaration does not enforce uniqueness count", () => {
        const mockProjectIndex = {
            files: {
                "a.gml": {
                    declarations: [
                        { name: "sub", start: { index: 1 }, classifications: ["staticVariable"] },
                        { name: "sub", start: { index: 10 }, classifications: ["staticVariable"] }
                    ]
                }
            }
        };
        const bridge = new GmlSemanticBridge(mockProjectIndex, "/tmp");

        // Mock method to bypass internal calls
        (bridge as any).localNamingCategoryResolver = {
            isConstructorStaticMember: () => true
        };

        const result = (bridge as any).isConstructorStaticMemberDeclaration("a.gml", {
            name: "sub",
            start: { index: 10 }
        });
        assert.equal(result, true);
    });

    void it("collectGlobalAndInstanceNamingTargets skips instance and global variables shadowing macros and enums", async () => {
        const bridge = new GmlSemanticBridge(
            {
                identifiers: {
                    macros: {
                        "macro:INPUT_KEYBOARD": { identifierId: "macro:INPUT_KEYBOARD", name: "INPUT_KEYBOARD" },
                        "macro:MACRO_ONLY": { identifierId: "macro:MACRO_ONLY", name: "MACRO_ONLY" }
                    },
                    enums: {
                        "enum:e__InputSource": { identifierId: "enum:e__InputSource", name: "e__InputSource" }
                    },
                    globalVariables: {
                        "var:INPUT_KEYBOARD": {
                            identifierId: "var:INPUT_KEYBOARD",
                            name: "INPUT_KEYBOARD",
                            declarations: [{ filePath: "fake.gml", start: { index: 0 }, end: { index: 1 } }]
                        },
                        "var:e__InputSource": {
                            identifierId: "var:e__InputSource",
                            name: "e__InputSource",
                            declarations: [{ filePath: "fake.gml", start: { index: 0 }, end: { index: 1 } }]
                        },
                        "var:validGlobal": {
                            identifierId: "var:validGlobal",
                            name: "validGlobal",
                            declarations: [{ filePath: "fake.gml", start: { index: 0 }, end: { index: 1 } }]
                        }
                    },
                    instanceVariables: {
                        "var:INPUT_KEYBOARD": {
                            identifierId: "var:INPUT_KEYBOARD",
                            name: "INPUT_KEYBOARD",
                            declarations: [{ filePath: "fake.gml", start: { index: 0 }, end: { index: 1 } }]
                        },
                        "var:e__InputSource": {
                            identifierId: "var:e__InputSource",
                            name: "e__InputSource",
                            declarations: [{ filePath: "fake.gml", start: { index: 0 }, end: { index: 1 } }]
                        },
                        "var:validInstance": {
                            identifierId: "var:validInstance",
                            name: "validInstance",
                            declarations: [{ filePath: "fake.gml", start: { index: 0 }, end: { index: 1 } }]
                        }
                    }
                },
                resources: {},
                files: {
                    "fake.gml": { path: "fake.gml", declarations: [] }
                },
                scopes: {}
            } as any,
            "/fake/path"
        );

        const targets = await bridge.listNamingConventionTargets(["fake.gml"]);
        const globalTargets = targets.filter((t) => t.category === "globalVariable").map((t) => t.name);
        const instanceTargets = targets.filter((t) => t.category === "instanceVariable").map((t) => t.name);

        assert.deepEqual(globalTargets, ["validGlobal"], "globalVariables masking a macro/enum should be excluded");
        assert.deepEqual(
            instanceTargets,
            ["validInstance"],
            "instanceVariables masking a macro/enum should be excluded"
        );
    });
});
