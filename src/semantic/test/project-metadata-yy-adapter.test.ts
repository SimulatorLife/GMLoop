import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    applyProjectMetadataStringMutations,
    findProjectMetadataValueTextRange,
    getProjectMetadataValueAtPath,
    isProjectMetadataParseError,
    isProjectMetadataSchemaValidationError,
    parseProjectMetadataDocument,
    parseProjectMetadataDocumentForMutation,
    parseProjectMetadataDocumentWithSchema,
    readProjectMetadataDocumentForMutationFromFile,
    readProjectMetadataDocumentFromFile,
    resolveProjectMetadataSchemaName,
    stringifyProjectMetadataDocument,
    updateProjectMetadataReferenceByPath,
    writeProjectMetadataDocumentToFile
} from "../src/project-metadata/yy-adapter.js";

void test("parseProjectMetadataDocument accepts trailing commas", () => {
    const parsed = parseProjectMetadataDocument(
        `{
            "name":"scr_demo",
            "resourceType":"GMScript",
        }`,
        "/tmp/scripts/scr_demo/scr_demo.yy"
    );

    assert.equal(parsed.name, "scr_demo");
    assert.equal(parsed.resourceType, "GMScript");
});

void test("parseProjectMetadataDocument returns parse errors with dedicated type", () => {
    let caught: unknown;
    try {
        parseProjectMetadataDocument("{ invalid", "/tmp/scripts/scr_demo/scr_demo.yy");
    } catch (error) {
        caught = error;
    }

    assert.ok(isProjectMetadataParseError(caught));
});

void test("stringifyProjectMetadataDocument emits GameMaker-compatible output", () => {
    const output = stringifyProjectMetadataDocument({
        name: "scr_demo",
        resourceType: "GMScript"
    });

    assert.match(output, /"name"\s*:\s*"scr_demo"/);
    assert.match(output, /"resourceType"\s*:\s*"GMScript"/);
});

void test("resolveProjectMetadataSchemaName prefers resourceType mapping", () => {
    const schema = resolveProjectMetadataSchemaName("objects/oPlayer/oPlayer.yy", "GMScript");
    assert.equal(schema, "scripts");
});

void test("resolveProjectMetadataSchemaName falls back to source path", () => {
    const schema = resolveProjectMetadataSchemaName("rooms/room_start/room_start.yy");
    assert.equal(schema, "rooms");
});

void test("resolveProjectMetadataSchemaName infers schema names from absolute metadata paths", () => {
    const schema = resolveProjectMetadataSchemaName("/tmp/project/objects/o_player/o_player.yy");
    assert.equal(schema, "objects");
});

void test("parseProjectMetadataDocumentWithSchema returns inferred schema details", () => {
    const parsed = parseProjectMetadataDocumentWithSchema(
        `{
            "name":"o_player",
            "resourceType":"GMObject",
        }`,
        "/tmp/objects/o_player/o_player.yy"
    );

    assert.equal(parsed.schemaName, "objects");
    assert.equal(parsed.schemaValidated, true);
    assert.equal(parsed.document.name, "o_player");
    assert.equal(parsed.document.resourceType, "GMObject");
});

void test("parseProjectMetadataDocumentWithSchema reports schema validation failures", () => {
    const parsed = parseProjectMetadataDocumentWithSchema(
        `{
            "name":"o_player",
            "resourceType":"GMObject",
            "eventList":"invalid",
        }`,
        "/tmp/objects/o_player/o_player.yy"
    );

    assert.equal(parsed.schemaName, "objects");
    assert.equal(parsed.schemaValidated, false);
    assert.ok(parsed.schemaError);
    assert.equal(parsed.document.name, "o_player");
    assert.equal(parsed.document.resourceType, "GMObject");
});

void test("parseProjectMetadataDocumentForMutation enforces inferred schema validation", () => {
    let caught: unknown;
    try {
        parseProjectMetadataDocumentForMutation(
            `{
                "name":"o_player",
                "resourceType":"GMObject",
                "eventList":"invalid",
            }`,
            "/tmp/objects/o_player/o_player.yy"
        );
    } catch (error) {
        caught = error;
    }

    assert.ok(isProjectMetadataSchemaValidationError(caught));
});

void test("parseProjectMetadataDocumentForMutation allows loose project manifest parsing without schema filtering", () => {
    const parsed = parseProjectMetadataDocumentForMutation(
        `{
            "name":"MyProject",
            "resourceType":"GMProject",
            "resources":[{"id":{"name":"o_player","path":"objects/o_player/o_player.yy",}}],
        }`,
        "/tmp/project.yyp"
    );

    assert.equal(parsed.schemaName, null);
    assert.equal(parsed.schemaValidated, false);
    assert.equal(parsed.document.resourceType, "GMProject");
});

void test("updateProjectMetadataReferenceByPath updates object references", () => {
    const document: Record<string, unknown> = {
        spriteId: {
            name: "spr_player",
            path: "sprites/spr_player/spr_player.yy"
        }
    };

    const changed = updateProjectMetadataReferenceByPath({
        document,
        propertyPath: "spriteId",
        newResourcePath: "sprites/spr_hero/spr_hero.yy",
        newName: "spr_hero"
    });

    assert.equal(changed, true);
    assert.deepEqual(document.spriteId, {
        name: "spr_hero",
        path: "sprites/spr_hero/spr_hero.yy"
    });
});

void test("updateProjectMetadataReferenceByPath updates direct string paths", () => {
    const document: Record<string, unknown> = {
        Folders: [
            {
                name: "Scripts",
                folderPath: "folders/Scripts.yy"
            }
        ]
    };

    const changed = updateProjectMetadataReferenceByPath({
        document,
        propertyPath: "Folders.0.folderPath",
        newResourcePath: "folders/Code.yy",
        newName: null
    });

    assert.equal(changed, true);
    assert.equal(getProjectMetadataValueAtPath(document, "Folders.0.folderPath"), "folders/Code.yy");
});

void test("findProjectMetadataValueTextRange locates nested manifest reference strings", () => {
    const rawContents = `{
  "resources":[
    {"id":{"name":"CM_TRIANGLE_GET_CAPSULE_REF","path":"scripts/CM_TRIANGLE_GET_CAPSULE_REF/CM_TRIANGLE_GET_CAPSULE_REF.yy",},},
  ],
}
`;

    const nameRange = findProjectMetadataValueTextRange(rawContents, "resources.0.id.name");
    const pathRange = findProjectMetadataValueTextRange(rawContents, "resources.0.id.path");

    assert.deepEqual(nameRange && rawContents.slice(nameRange.start, nameRange.end), '"CM_TRIANGLE_GET_CAPSULE_REF"');
    assert.deepEqual(
        pathRange && rawContents.slice(pathRange.start, pathRange.end),
        '"scripts/CM_TRIANGLE_GET_CAPSULE_REF/CM_TRIANGLE_GET_CAPSULE_REF.yy"'
    );
});

void test("applyProjectMetadataStringMutations preserves unrelated room float literals", () => {
    const rawContents = `{
  "layers":[
    {"instances":[
      {"objectId":{"name":"oPlayer","path":"objects/oPlayer/oPlayer.yy",},"rotation":3.7500002,"scaleX":1.7499999,},
      {"objectId":{"name":"oGoal","path":"objects/oGoal/oGoal.yy",},"rotation":0.0,"scaleX":1.0,},
    ],"depth":100.0,},
  ],
}
`;

    const rewritten = applyProjectMetadataStringMutations(rawContents, [
        {
            propertyPath: "layers.0.instances.0.objectId.name",
            value: "obj_o_player"
        },
        {
            propertyPath: "layers.0.instances.0.objectId.path",
            value: "objects/obj_o_player/obj_o_player.yy"
        },
        {
            propertyPath: "layers.0.instances.1.objectId.name",
            value: "obj_o_goal"
        },
        {
            propertyPath: "layers.0.instances.1.objectId.path",
            value: "objects/obj_o_goal/obj_o_goal.yy"
        }
    ]);

    assert.ok(rewritten);
    assert.match(rewritten, /"name":"obj_o_player"/u);
    assert.match(rewritten, /"path":"objects\/obj_o_player\/obj_o_player\.yy"/u);
    assert.match(rewritten, /"name":"obj_o_goal"/u);
    assert.match(rewritten, /"path":"objects\/obj_o_goal\/obj_o_goal\.yy"/u);
    assert.match(rewritten, /"rotation":3\.7500002/u);
    assert.match(rewritten, /"scaleX":1\.7499999/u);
    assert.match(rewritten, /"depth":100\.0/u);
});

void test("readProjectMetadataDocumentFromFile parses metadata from disk", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-yy-adapter-read-"));
    const metadataPath = path.join(tempRoot, "objects", "o_player", "o_player.yy");
    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
    fs.writeFileSync(
        metadataPath,
        `{
            "name":"o_player",
            "resourceType":"GMObject",
        }`,
        "utf8"
    );

    const parsed = readProjectMetadataDocumentFromFile(metadataPath);
    assert.equal(parsed.document.name, "o_player");
    assert.equal(parsed.schemaName, "objects");
    assert.equal(parsed.schemaValidated, true);
});

void test("readProjectMetadataDocumentForMutationFromFile enforces schema checks", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-yy-adapter-strict-read-"));
    const metadataPath = path.join(tempRoot, "objects", "o_player", "o_player.yy");
    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
    fs.writeFileSync(
        metadataPath,
        `{
            "name":"o_player",
            "resourceType":"GMObject",
            "eventList":"invalid",
        }`,
        "utf8"
    );

    assert.throws(() => {
        readProjectMetadataDocumentForMutationFromFile(metadataPath);
    });
});

void test("writeProjectMetadataDocumentToFile delegates writes through yy writer", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-yy-adapter-write-"));
    const metadataPath = path.join(tempRoot, "scripts", "demo", "demo.yy");
    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });

    const firstWrite = writeProjectMetadataDocumentToFile(metadataPath, {
        name: "demo",
        resourceType: "GMScript"
    });
    const secondWrite = writeProjectMetadataDocumentToFile(metadataPath, {
        name: "demo",
        resourceType: "GMScript"
    });

    assert.equal(firstWrite, true);
    assert.equal(secondWrite, false);
    const written = fs.readFileSync(metadataPath, "utf8");
    assert.match(written, /"resourceType"\s*:\s*"GMScript"/);
});

void test("writeProjectMetadataDocumentToFile normalizes resourceType before resourcePath", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-yy-adapter-normalize-"));
    const metadataPath = path.join(tempRoot, "scripts", "demo", "demo.yy");
    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });

    fs.writeFileSync(
        metadataPath,
        `{\n  "name":"demo",\n  "resourcePath":"scripts/demo/demo.yy",\n  "resourceType":"GMScript"\n}`,
        "utf8"
    );

    const changed = writeProjectMetadataDocumentToFile(metadataPath, {
        name: "demo",
        resourcePath: "scripts/demo/demo.yy",
        resourceType: "GMScript"
    });

    assert.equal(changed, true);

    const written = fs.readFileSync(metadataPath, "utf8");
    const typeIndex = written.indexOf('"resourceType"');
    const pathIndex = written.indexOf('"resourcePath"');

    assert.ok(typeIndex !== -1);
    assert.ok(pathIndex !== -1);
    assert.ok(typeIndex < pathIndex, "resourceType should appear before resourcePath in normalized output");
});

void test("stringifyProjectMetadataDocument preserves resourceType before resourcePath", () => {
    const document: Record<string, unknown> = {
        $GMScript: "v1",
        "%Name": "demo",
        isCompatibility: false,
        isDnD: false,
        name: "demo",
        parent: {
            name: "Test",
            path: "folders/Test/Test.yy"
        },
        resourcePath: "scripts/demo/demo.yy",
        resourceType: "GMScript",
        resourceVersion: "2.0"
    };

    const output = stringifyProjectMetadataDocument(document, "scripts/demo/demo.yy");

    const firstIndex = output.indexOf('"resourceType"');
    const secondIndex = output.indexOf('"resourcePath"');

    assert.ok(firstIndex !== -1, "resourceType exists in output");
    assert.ok(secondIndex !== -1, "resourcePath exists in output");
    assert.ok(firstIndex < secondIndex, "resourceType should appear before resourcePath in output");
});

void test("stringifyProjectMetadataDocument preserves fixed-point metadata after structuredClone", () => {
    const parsed = parseProjectMetadataDocumentForMutation(
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
          "frames":[
            {"$GMSpriteFrame":"v1","%Name":"a777fc4d-ac59-4464-b4bd-e93704762166","name":"a777fc4d-ac59-4464-b4bd-e93704762166","resourceType":"GMSpriteFrame","resourceVersion":"2.0",},
          ],
          "gridX":0,
          "gridY":0,
          "height":32,
          "HTile":false,
          "layers":[
            {"$GMImageLayer":"","%Name":"c7545ec4-2c29-4b5e-9814-c7ec66e59442","blendMode":0,"displayName":"default","isLocked":false,"name":"c7545ec4-2c29-4b5e-9814-c7ec66e59442","opacity":100.0,"resourceType":"GMImageLayer","resourceVersion":"2.0","visible":true,},
          ],
          "name":"sprPlayer",
          "nineSlice":null,
          "origin":4,
          "parent":{"name":"Sprites","path":"folders/02 Textures/Sprites.yy",},
          "preMultiplyAlpha":false,
          "resourceType":"GMSprite",
          "resourceVersion":"2.0",
          "sequence":{
            "$GMSequence":"v1",
            "%Name":"sprPlayer",
            "autoRecord":true,
            "backdropHeight":768,
            "backdropImageOpacity":0.5,
            "backdropImagePath":"",
            "backdropWidth":1366,
            "backdropXOffset":0.0,
            "backdropYOffset":0.0,
            "events":{"$KeyframeStore<MessageEventKeyframe>":"","Keyframes":[],"resourceType":"KeyframeStore<MessageEventKeyframe>","resourceVersion":"2.0",},
            "eventStubScript":null,
            "eventToFunction":{},
            "length":1.0,
            "lockOrigin":false,
            "moments":{"$KeyframeStore<MomentsEventKeyframe>":"","Keyframes":[],"resourceType":"KeyframeStore<MomentsEventKeyframe>","resourceVersion":"2.0",},
            "name":"sprPlayer",
            "playback":1,
            "playbackSpeed":30.0,
            "playbackSpeedType":0,
            "resourceType":"GMSequence",
            "resourceVersion":"2.0",
            "seqHeight":32.0,
            "seqWidth":32.0,
            "showBackdrop":true,
            "showBackdropImage":false,
            "timeUnits":1,
            "tracks":[
              {"$GMSpriteFramesTrack":"","builtinName":0,"events":[],"inheritsTrackColour":true,"interpolation":1,"isCreationTrack":false,"keyframes":{"$KeyframeStore<SpriteFrameKeyframe>":"","Keyframes":[
                    {"$Keyframe<SpriteFrameKeyframe>":"","Channels":{"0":{"$SpriteFrameKeyframe":"","Id":{"name":"a777fc4d-ac59-4464-b4bd-e93704762166","path":"sprites/sprPlayer/sprPlayer.yy",},"resourceType":"SpriteFrameKeyframe","resourceVersion":"2.0",},},"Disabled":false,"id":"213eb663-edd6-48de-82c6-c2a8d2c0ebb7","IsCreationKey":false,"Key":0.0,"Length":1.0,"resourceType":"Keyframe<SpriteFrameKeyframe>","resourceVersion":"2.0","Stretch":false,},
                  ],"resourceType":"KeyframeStore<SpriteFrameKeyframe>","resourceVersion":"2.0",},"modifiers":[],"name":"frames","resourceType":"GMSpriteFramesTrack","resourceVersion":"2.0","spriteId":null,"trackColour":0,"tracks":[],"traits":0,},
            ],
            "visibleRange":null,
            "volume":1.0,
            "xorigin":16,
            "yorigin":16,
          },
          "swatchColours":null,
          "swfPrecision":2.525,
          "textureGroupId":{"name":"Default","path":"texturegroups/Default",},
          "type":0,
          "VTile":false,
          "width":32,
        }`,
        "/tmp/sprites/sprPlayer/sprPlayer.yy"
    );

    const clonedDocument = structuredClone(parsed.document);
    const output = stringifyProjectMetadataDocument(clonedDocument, "sprites/sprPlayer/sprPlayer.yy");

    assert.match(output, /"opacity":100\.0/u);
    assert.match(output, /"backdropImageOpacity":0\.5/u);
    assert.match(output, /"backdropXOffset":0\.0/u);
    assert.match(output, /"length":1\.0/u);
    assert.match(output, /"playbackSpeed":30\.0/u);
    assert.match(output, /"Key":0\.0/u);
    assert.match(output, /"Length":1\.0/u);
    assert.match(output, /"volume":1\.0/u);
    assert.doesNotMatch(output, /"opacity":\{\}/u);
    assert.doesNotMatch(output, /"backdropImageOpacity":\{\}/u);
    assert.doesNotMatch(output, /"backdropXOffset":\{\}/u);
    assert.doesNotMatch(output, /"length":\{\}/u);
    assert.doesNotMatch(output, /"playbackSpeed":\{\}/u);
    assert.doesNotMatch(output, /"Key":\{\}/u);
    assert.doesNotMatch(output, /"Length":\{\}/u);
    assert.doesNotMatch(output, /"volume":\{\}/u);
});

void test("isProjectMetadataParseError accepts cross-realm error-like objects with matching name", () => {
    const crossRealmError = { name: "ProjectMetadataParseError", message: "simulated cross-realm parse failure" };
    assert.ok(isProjectMetadataParseError(crossRealmError));
});

void test("isProjectMetadataSchemaValidationError accepts cross-realm error-like objects with matching name", () => {
    const crossRealmError = {
        name: "ProjectMetadataSchemaValidationError",
        message: "simulated cross-realm schema validation failure"
    };
    assert.ok(isProjectMetadataSchemaValidationError(crossRealmError));
});

void test("isProjectMetadataParseError rejects unrelated error objects", () => {
    const unrelatedError = new Error("unrelated error");
    assert.equal(isProjectMetadataParseError(unrelatedError), false);
    assert.equal(isProjectMetadataParseError(null), false);
    assert.equal(isProjectMetadataParseError({ name: "" }), false);
});

void test("isProjectMetadataSchemaValidationError rejects unrelated error objects", () => {
    const unrelatedError = new Error("unrelated error");
    assert.equal(isProjectMetadataSchemaValidationError(unrelatedError), false);
    assert.equal(isProjectMetadataSchemaValidationError(null), false);
    assert.equal(isProjectMetadataSchemaValidationError({ name: "" }), false);
});
