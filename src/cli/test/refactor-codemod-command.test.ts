import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Parser } from "@gmloop/parser";

import { runCliTestCommand } from "../src/cli.js";
import {
    assertProjectGmlFilesParse,
    createSyntheticRefactorProject as createSyntheticProject,
    registerProjectResource,
    writeObjectResource,
    writeProjectFile,
    writeScriptResource
} from "./test-helpers/refactor-codemod-command-fixture.js";

void test("refactor codemod --list discovers gmloop.json and tolerates unrelated top-level config", async () => {
    const projectRoot = await createSyntheticProject({
        printWidth: 95,
        lintRules: {
            "gml/no-globalvar": "error"
        },
        refactor: {
            codemods: {
                loopLengthHoisting: {}
            }
        }
    });

    try {
        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--list"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /Project root:/);
        assert.match(result.stdout, /Config path:/);
        assert.match(result.stdout, /loopLengthHoisting: configured, selected/);
        assert.match(result.stdout, /Effective config: \{\}/);
        assert.match(result.stdout, /namingConvention: not configured, selected/);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --only filters configured codemods during listing", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                loopLengthHoisting: {},
                namingConvention: {
                    rules: {
                        localVariable: {
                            caseStyle: "camel"
                        }
                    }
                }
            }
        }
    });

    try {
        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--list", "--only", "loopLengthHoisting"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /loopLengthHoisting: configured, selected/);
        assert.match(result.stdout, /namingConvention: configured, filtered out/);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write applies configured namingConvention renames across project resources", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        scriptResourceName: {
                            caseStyle: "camel"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(projectRoot, "demo_script", "function demo_script() {\n    return 1;\n}\n");
        await writeScriptResource(
            projectRoot,
            "consumer_script",
            "function consumer_script() {\n    return demo_script();\n}\n"
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "scripts/demo_script", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        await access(path.join(projectRoot, "scripts/demoScript/demoScript.gml"));
        const renamedSource = await readFile(path.join(projectRoot, "scripts/demoScript/demoScript.gml"), "utf8");
        const consumerSource = await readFile(
            path.join(projectRoot, "scripts/consumer_script/consumer_script.gml"),
            "utf8"
        );
        const renamedMetadata = await readFile(path.join(projectRoot, "scripts/demoScript/demoScript.yy"), "utf8");

        assert.match(renamedSource, /function demoScript\(\)/);
        assert.match(consumerSource, /demoScript\(\)/);
        assert.match(renamedMetadata, /"name"\s*:\s*"demoScript"/);
        await assert.rejects(access(path.join(projectRoot, "scripts/demo_script/demo_script.gml")));
        assert.match(result.stdout, /\[namingConvention\] changed/);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write preserves allowed leading underscores while applying safe snake-case renames", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        resource: {
                            caseStyle: "lower_snake"
                        },
                        variable: {
                            caseStyle: "lower_snake"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "__InputError",
            "function __InputError() {\n    var _TargetShader = 1;\n    return _TargetShader;\n}\n"
        );
        await writeScriptResource(
            projectRoot,
            "consumer_script",
            "function consumer_script() {\n    return __InputError();\n}\n"
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        await access(path.join(projectRoot, "scripts/__input_error/__input_error.gml"));
        const renamedSource = await readFile(path.join(projectRoot, "scripts/__input_error/__input_error.gml"), "utf8");
        const renamedMetadata = await readFile(
            path.join(projectRoot, "scripts/__input_error/__input_error.yy"),
            "utf8"
        );
        const consumerSource = await readFile(
            path.join(projectRoot, "scripts/consumer_script/consumer_script.gml"),
            "utf8"
        );

        assert.match(renamedSource, /function __input_error\(\)/);
        assert.match(renamedSource, /var _target_shader = 1;/);
        assert.match(renamedSource, /return _target_shader;/);
        assert.match(renamedMetadata, /"name"\s*:\s*"__input_error"/);
        assert.match(consumerSource, /return __input_error\(\);/);

        const typeIndex = renamedMetadata.indexOf('"resourceType"');
        const pathIndex = renamedMetadata.indexOf('"resourcePath"');
        assert.ok(typeIndex !== -1 && pathIndex !== -1 && typeIndex < pathIndex);
        await assert.rejects(access(path.join(projectRoot, "scripts/input_error/input_error.gml")));
        await assert.rejects(access(path.join(projectRoot, "scripts/__InputError/__InputError.gml")));
        assert.match(result.stdout, /\[namingConvention\] changed/);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write renames sibling object metadata inside a folder renamed earlier in the same batch", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        resource: {
                            caseStyle: "lower_snake"
                        },
                        objectResourceName: {
                            prefix: "obj_"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeProjectFile(
            projectRoot,
            "objects/oColmesh2DemoCylinder/oColmesh2DemoCylinder.yy",
            `{
  "resourceType":"GMObject",
  "resourcePath":"objects/oColmesh2DemoCylinder/oColmesh2DemoCylinder.yy",
  "name":"oColmesh2DemoCylinder"
}
`
        );
        await writeProjectFile(
            projectRoot,
            "objects/oColmesh2DemoCylinder/oColmeshDemo2Sphere.yy",
            `{
  "resourceType":"GMObject",
  "resourcePath":"objects/oColmesh2DemoCylinder/oColmeshDemo2Sphere.yy",
  "name":"oColmeshDemo2Sphere"
}
`
        );
        await registerProjectResource(
            projectRoot,
            "oColmesh2DemoCylinder",
            "objects/oColmesh2DemoCylinder/oColmesh2DemoCylinder.yy"
        );
        await registerProjectResource(
            projectRoot,
            "oColmeshDemo2Sphere",
            "objects/oColmesh2DemoCylinder/oColmeshDemo2Sphere.yy"
        );

        const result = await runCliTestCommand({ argv: ["refactor", "codemod", "--write"], cwd: projectRoot });

        assert.equal(result.exitCode, 0);
        await access(path.join(projectRoot, "objects/obj_colmesh2demo_cylinder/obj_colmesh2demo_cylinder.yy"));
        await access(path.join(projectRoot, "objects/obj_colmesh2demo_cylinder/obj_colmesh_demo2sphere.yy"));
        await assert.rejects(access(path.join(projectRoot, "objects/oColmesh2DemoCylinder/oColmeshDemo2Sphere.yy")));

        const siblingMetadata = await readFile(
            path.join(projectRoot, "objects/obj_colmesh2demo_cylinder/obj_colmesh_demo2sphere.yy"),
            "utf8"
        );
        const projectManifest = await readFile(path.join(projectRoot, "MyGame.yyp"), "utf8");

        assert.match(siblingMetadata, /"name"\s*:\s*"obj_colmesh_demo2sphere"/);
        assert.match(
            siblingMetadata,
            /"resourcePath"\s*:\s*"objects\/obj_colmesh2demo_cylinder\/obj_colmesh_demo2sphere\.yy"/
        );
        assert.match(projectManifest, /"name"\s*:\s*"obj_colmesh2demo_cylinder"/);
        assert.match(projectManifest, /"name"\s*:\s*"obj_colmesh_demo2sphere"/);
        assert.match(result.stdout, /\[namingConvention\] changed/);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write normalizes existing script metadata resourceType/resourcePath order", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        resource: {
                            caseStyle: "lower_snake"
                        },
                        variable: {
                            caseStyle: "lower_snake"
                        }
                    }
                }
            }
        }
    });

    try {
        const scriptDir = path.join(projectRoot, "scripts", "__InputError");
        await mkdir(scriptDir, { recursive: true });

        await writeProjectFile(
            projectRoot,
            "scripts/__InputError/__InputError.yy",
            `{
  "resourcePath":"scripts/__InputError/__InputError.yy",
  "resourceType":"GMScript",
  "name":"__InputError"
}`
        );
        await writeProjectFile(
            projectRoot,
            "scripts/__InputError/__InputError.gml",
            "function __InputError() { return 1; }\n"
        );

        const result = await runCliTestCommand({ argv: ["refactor", "codemod", "--write"], cwd: projectRoot });
        assert.equal(result.exitCode, 0);

        const metadata = await readFile(path.join(projectRoot, "scripts", "__input_error", "__input_error.yy"), "utf8");
        const typeIndex = metadata.indexOf('"resourceType"');
        const pathIndex = metadata.indexOf('"resourcePath"');

        assert.ok(typeIndex !== -1, "resourceType should exist after rename");
        assert.ok(pathIndex !== -1, "resourcePath should exist after rename");
        assert.ok(typeIndex < pathIndex, "resourceType must come before resourcePath to be valid for GameMaker");
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write does not add resourcePath to scripts that did not have one", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        resource: {
                            caseStyle: "lower_snake"
                        },
                        variable: {
                            caseStyle: "lower_snake"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeProjectFile(
            projectRoot,
            "scripts/__InputError/__InputError.yy",
            `{
  "resourceType":"GMScript",
  "name":"__InputError"
}`
        );
        await writeProjectFile(
            projectRoot,
            "scripts/__InputError/__InputError.gml",
            "function __InputError() { return 1; }\n"
        );

        const result = await runCliTestCommand({ argv: ["refactor", "codemod", "--write"], cwd: projectRoot });
        assert.equal(result.exitCode, 0);

        const metadata = await readFile(path.join(projectRoot, "scripts", "__input_error", "__input_error.yy"), "utf8");
        assert.match(metadata, /"name"\s*:\s*"__input_error"/);
        assert.match(metadata, /"resourceType"\s*:\s*"GMScript"/);
        assert.doesNotMatch(metadata, /"resourcePath"\s*:/);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write renames implicit instance variables across object event files", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        variable: {
                            caseStyle: "lower_snake"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeObjectResource(projectRoot, "oActorParent", {
            "Create_0.gml": "charMat = matrix_build_identity();\n",
            "Step_0.gml": "var turnSpd = move_spd * 0.4;\ncharMat[0] += turnSpd;\n"
        });

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        const createSource = await readFile(path.join(projectRoot, "objects/oActorParent/Create_0.gml"), "utf8");
        const stepSource = await readFile(path.join(projectRoot, "objects/oActorParent/Step_0.gml"), "utf8");

        assert.match(createSource, /char_mat = matrix_build_identity\(\);/);
        assert.match(stepSource, /var turn_spd = move_spd \* 0\.4;/);
        assert.match(stepSource, /char_mat\[0\] \+= turn_spd;/);
        assert.doesNotMatch(stepSource, /\bcharMat\b/);
        assert.match(result.stdout, /\[namingConvention\] changed/);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write renames implicit instance variables across inherited child objects and dotted object references", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        variable: {
                            caseStyle: "lower_snake"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeProjectFile(
            projectRoot,
            "objects/oActorParent/oActorParent.yy",
            `${JSON.stringify(
                {
                    resourceType: "GMObject",
                    resourcePath: "objects/oActorParent/oActorParent.yy",
                    name: "oActorParent"
                },
                null,
                4
            )}\n`
        );
        await writeProjectFile(
            projectRoot,
            "objects/oActorParent/Create_0.gml",
            ["upDir = new Vector3(0, 0, 1);", "activePlayer = false;", ""].join("\n")
        );
        await registerProjectResource(projectRoot, "oActorParent", "objects/oActorParent/oActorParent.yy");

        await writeProjectFile(
            projectRoot,
            "objects/oPlayer/oPlayer.yy",
            `${JSON.stringify(
                {
                    resourceType: "GMObject",
                    resourcePath: "objects/oPlayer/oPlayer.yy",
                    name: "oPlayer",
                    parentObjectId: {
                        name: "oActorParent",
                        path: "objects/oActorParent/oActorParent.yy"
                    }
                },
                null,
                4
            )}\n`
        );
        await writeProjectFile(
            projectRoot,
            "objects/oPlayer/Create_0.gml",
            [
                "event_inherited();",
                "basis = { up: upDir };",
                "if (!activePlayer) {",
                "    show_debug_message(upDir);",
                "}",
                "show_debug_message(oCamera.camMat);",
                "show_debug_message(oCamera.camXfrom);",
                ""
            ].join("\n")
        );
        await registerProjectResource(projectRoot, "oPlayer", "objects/oPlayer/oPlayer.yy");

        await writeProjectFile(
            projectRoot,
            "objects/oCamera/oCamera.yy",
            `${JSON.stringify(
                {
                    resourceType: "GMObject",
                    resourcePath: "objects/oCamera/oCamera.yy",
                    name: "oCamera"
                },
                null,
                4
            )}\n`
        );
        await writeProjectFile(
            projectRoot,
            "objects/oCamera/Create_0.gml",
            [
                "camMat = matrix_build_identity();",
                "camXfrom = x;",
                "follow_id = oPlayer;",
                "show_debug_message(follow_id.upDir);",
                "show_debug_message(follow_id.activePlayer);",
                ""
            ].join("\n")
        );
        await registerProjectResource(projectRoot, "oCamera", "objects/oCamera/oCamera.yy");

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);

        const parentSource = await readFile(path.join(projectRoot, "objects/oActorParent/Create_0.gml"), "utf8");
        const playerSource = await readFile(path.join(projectRoot, "objects/oPlayer/Create_0.gml"), "utf8");
        const cameraSource = await readFile(path.join(projectRoot, "objects/oCamera/Create_0.gml"), "utf8");

        assert.match(parentSource, /up_dir = new Vector3\(0, 0, 1\);/);
        assert.match(parentSource, /active_player = false;/);
        assert.match(playerSource, /basis = \{ up: up_dir \};/);
        assert.match(playerSource, /if \(!active_player\) \{/);
        assert.match(playerSource, /show_debug_message\(up_dir\);/);
        assert.match(playerSource, /show_debug_message\(oCamera\.cam_mat\);/);
        assert.match(playerSource, /show_debug_message\(oCamera\.cam_xfrom\);/);
        assert.match(cameraSource, /cam_mat = matrix_build_identity\(\);/);
        assert.match(cameraSource, /cam_xfrom = x;/);
        assert.match(cameraSource, /show_debug_message\(follow_id\.up_dir\);/);
        assert.match(cameraSource, /show_debug_message\(follow_id\.active_player\);/);
        assert.doesNotMatch(playerSource, /\bupDir\b/);
        assert.doesNotMatch(playerSource, /\bactivePlayer\b/);
        assert.doesNotMatch(playerSource, /\.camMat\b/);
        assert.doesNotMatch(playerSource, /\.camXfrom\b/);
        assert.doesNotMatch(cameraSource, /\.upDir\b/);
        assert.doesNotMatch(cameraSource, /\.activePlayer\b/);

        await assertProjectGmlFilesParse(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write does not overlap object-resource renames with implicit instance-variable renames", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        resource: {
                            caseStyle: "lower_snake"
                        },
                        objectResourceName: {
                            prefix: "obj_"
                        },
                        variable: {
                            caseStyle: "lower_snake"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeObjectResource(projectRoot, "oCamera", {
            "Create_0.gml": ["camMat = matrix_build_identity();", "camXfrom = x;", ""].join("\n")
        });
        await writeObjectResource(projectRoot, "oPlayer", {
            "Create_0.gml": [
                "if (instance_exists(oCamera)) {",
                "    with (oCamera) {",
                "        show_debug_message(camMat[0]);",
                "    }",
                "}",
                "camera_horizontal_x = pos.x - oCamera.camXfrom;",
                "camera_horizontal_y = pos.y - oCamera.camMat[1];",
                ""
            ].join("\n"),
            "Draw_73.gml": [
                "if (instance_exists(oCamera)) {",
                "    draw_text(0, 0, string(oCamera.camXfrom));",
                "}",
                ""
            ].join("\n")
        });
        await writeObjectResource(projectRoot, "oSystem", {
            "Other_2.gml": ["instance_create_depth(0, 0, 0, oCamera);", ""].join("\n")
        });

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        assert.doesNotMatch(result.stderr, /Overlapping edits detected/);

        await assert.doesNotReject(access(path.join(projectRoot, "objects/obj_camera/obj_camera.yy")));
        await assert.rejects(access(path.join(projectRoot, "objects/oCamera/oCamera.yy")));

        const cameraSource = await readFile(path.join(projectRoot, "objects/obj_camera/Create_0.gml"), "utf8");
        const playerCreateSource = await readFile(path.join(projectRoot, "objects/obj_player/Create_0.gml"), "utf8");
        const playerDrawSource = await readFile(path.join(projectRoot, "objects/obj_player/Draw_73.gml"), "utf8");
        const systemSource = await readFile(path.join(projectRoot, "objects/obj_system/Other_2.gml"), "utf8");

        assert.match(cameraSource, /cam_mat = matrix_build_identity\(\);/);
        assert.match(cameraSource, /cam_xfrom = x;/);
        assert.match(playerCreateSource, /if \(instance_exists\(obj_camera\)\) \{/);
        assert.match(playerCreateSource, /with \(obj_camera\) \{/);
        assert.match(playerCreateSource, /show_debug_message\(cam_mat\[0\]\);/);
        assert.match(playerCreateSource, /camera_horizontal_x = pos\.x - obj_camera\.cam_xfrom;/);
        assert.match(playerCreateSource, /camera_horizontal_y = pos\.y - obj_camera\.cam_mat\[1\];/);
        assert.match(playerDrawSource, /draw_text\(0, 0, string\(obj_camera\.cam_xfrom\)\);/);
        assert.match(systemSource, /instance_create_depth\(0, 0, 0, obj_camera\);/);
        assert.doesNotMatch(playerCreateSource, /\boCamera\b/);
        assert.doesNotMatch(playerDrawSource, /\boCamera\b/);
        assert.doesNotMatch(systemSource, /\boCamera\b/);

        await assertProjectGmlFilesParse(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write preserves valid enum member accesses when locals share the same name", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        enum: {
                            prefix: "e",
                            caseStyle: "camel"
                        },
                        variable: {
                            caseStyle: "lower_snake"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "cm_misc",
            [
                "enum CM {",
                "    TYPE,",
                "    X,",
                "    Y,",
                "    Z,",
                "    SLOPEANGLE,",
                "    NUM",
                "}",
                "",
                "function cm_collider(X, Y, Z, slopeAngle = 40) {",
                "    var collider = array_create(CM.NUM);",
                "    collider[@ CM.X] = X;",
                "    collider[@ CM.Y] = Y;",
                "    collider[@ CM.Z] = Z;",
                "    collider[@ CM.SLOPEANGLE] = slopeAngle;",
                "    return collider;",
                "}",
                ""
            ].join("\n")
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        const updatedSource = await readFile(path.join(projectRoot, "scripts/cm_misc/cm_misc.gml"), "utf8");

        assert.match(updatedSource, /enum eCm \{/);
        assert.match(updatedSource, /function cm_collider\(x, y, z, slope_angle = 40\)/);
        assert.match(updatedSource, /collider\[@ eCm\.X\] = x;/);
        assert.match(updatedSource, /collider\[@ eCm\.Y\] = y;/);
        assert.match(updatedSource, /collider\[@ eCm\.Z\] = z;/);
        assert.match(updatedSource, /collider\[@ eCm\.SLOPEANGLE\] = slope_angle;/);
        assert.doesNotMatch(updatedSource, /\becmM\b/);
        assert.doesNotMatch(updatedSource, /\.xX\b/);
        assert.doesNotMatch(updatedSource, /\.yY\b/);
        assert.doesNotMatch(updatedSource, /\.zZ\b/);
        assert.doesNotMatch(updatedSource, /\bslope_anglee\b/);
        assert.doesNotThrow(() => {
            const ast = Parser.GMLParser.parse(updatedSource);
            assert.equal(ast.type, "Program");
        });
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write renames cross-file enum references and reparses the rewritten project", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        enum: {
                            prefix: "e",
                            caseStyle: "camel"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "cm_misc",
            ["enum CM_RAY {", "    MASK,", "    NUM", "}", ""].join("\n")
        );
        await writeScriptResource(
            projectRoot,
            "cm_aab",
            ["function cm_aab_cast_ray(ray, mask = ray[CM_RAY.MASK]) {", "    return ray[CM_RAY.NUM];", "}", ""].join(
                "\n"
            )
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        const enumSource = await readFile(path.join(projectRoot, "scripts/cm_misc/cm_misc.gml"), "utf8");
        const consumerSource = await readFile(path.join(projectRoot, "scripts/cm_aab/cm_aab.gml"), "utf8");

        assert.match(enumSource, /enum eCmRay \{/);
        assert.match(consumerSource, /mask = ray\[eCmRay\.MASK\]/);
        assert.match(consumerSource, /return ray\[eCmRay\.NUM\];/);
        assert.doesNotMatch(consumerSource, /\bCM_RAY\b/);

        await assertProjectGmlFilesParse(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write preserves enum members when same-name implicit instance-variable renames are applied", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        enum: {
                            prefix: "e",
                            caseStyle: "camel"
                        },
                        enumMember: {
                            caseStyle: "upper_snake"
                        },
                        variable: {
                            caseStyle: "lower_snake"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(projectRoot, "cm_misc", ["enum CM {", "    R,", "    NUM", "}", ""].join("\n"));
        await writeObjectResource(projectRoot, "oActorParent", {
            "Create_0.gml": ["R = 1;", "show_debug_message(R);", ""].join("\n")
        });
        await writeObjectResource(projectRoot, "oPlayer", {
            "Draw_73.gml": [
                "var collider = array_create(CM.NUM, 0);",
                "draw_text(0, 0, string(collider[CM.R]));",
                ""
            ].join("\n")
        });

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        const instanceSource = await readFile(path.join(projectRoot, "objects/oActorParent/Create_0.gml"), "utf8");
        const drawSource = await readFile(path.join(projectRoot, "objects/oPlayer/Draw_73.gml"), "utf8");

        assert.match(instanceSource, /^r = 1;/m);
        assert.match(instanceSource, /show_debug_message\(r\);/);
        assert.match(drawSource, /var collider = array_create\(eCm\.NUM, 0\);/);
        assert.match(drawSource, /string\(collider\[eCm\.R\]\)/);
        assert.doesNotMatch(drawSource, /eCm\.r\b/);

        await assertProjectGmlFilesParse(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write renames object resources together with object event references", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        objectResourceName: {
                            caseStyle: "lower_snake"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeObjectResource(projectRoot, "oCamera", {
            "Create_0.gml": ['show_debug_message("camera ready");', ""].join("\n")
        });
        await writeObjectResource(projectRoot, "oSystem", {
            "Other_2.gml": ["instance_create_depth(0, 0, 0, oCamera);", ""].join("\n")
        });

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);

        await assert.doesNotReject(access(path.join(projectRoot, "objects/o_camera/o_camera.yy")));
        await assert.rejects(access(path.join(projectRoot, "objects/oCamera/oCamera.yy")));
        await assert.doesNotReject(access(path.join(projectRoot, "objects/o_system/o_system.yy")));
        await assert.rejects(access(path.join(projectRoot, "objects/oSystem/oSystem.yy")));

        const projectSource = await readFile(path.join(projectRoot, "MyGame.yyp"), "utf8");
        const resourceSource = await readFile(path.join(projectRoot, "objects/o_camera/o_camera.yy"), "utf8");
        const systemResourceSource = await readFile(path.join(projectRoot, "objects/o_system/o_system.yy"), "utf8");
        const systemSource = await readFile(path.join(projectRoot, "objects/o_system/Other_2.gml"), "utf8");

        assert.match(projectSource, /"name"\s*:\s*"o_camera"/);
        assert.match(projectSource, /"path"\s*:\s*"objects\/o_camera\/o_camera\.yy"/);
        assert.match(projectSource, /"name"\s*:\s*"o_system"/);
        assert.match(projectSource, /"path"\s*:\s*"objects\/o_system\/o_system\.yy"/);
        assert.doesNotMatch(projectSource, /\boCamera\b/);
        assert.doesNotMatch(projectSource, /\boSystem\b/);
        assert.match(resourceSource, /"name"\s*:\s*"o_camera"/);
        assert.match(resourceSource, /"resourcePath"\s*:\s*"objects\/o_camera\/o_camera\.yy"/);
        assert.match(systemResourceSource, /"name"\s*:\s*"o_system"/);
        assert.match(systemResourceSource, /"resourcePath"\s*:\s*"objects\/o_system\/o_system\.yy"/);
        assert.match(systemSource, /instance_create_depth\(0, 0, 0, o_camera\);/);
        assert.doesNotMatch(systemSource, /\boCamera\b/);

        await assertProjectGmlFilesParse(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write renames cross-file enum member references without splitting digit tokens", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        enum: {
                            prefix: "e",
                            caseStyle: "camel"
                        },
                        enumMember: {
                            caseStyle: "upper_snake"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "input_defs",
            ["enum INPUT_VIRTUAL_TYPE {", "    DPAD_4DIR,", "    DPAD_8DIR", "}", ""].join("\n")
        );
        await writeScriptResource(
            projectRoot,
            "input_use",
            [
                "function input_use(_four_dir) {",
                "    return _four_dir ? INPUT_VIRTUAL_TYPE.DPAD_4DIR : INPUT_VIRTUAL_TYPE.DPAD_8DIR;",
                "}",
                ""
            ].join("\n")
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        const enumSource = await readFile(path.join(projectRoot, "scripts/input_defs/input_defs.gml"), "utf8");
        const consumerSource = await readFile(path.join(projectRoot, "scripts/input_use/input_use.gml"), "utf8");

        assert.match(enumSource, /enum eInputVirtualType \{/);
        assert.match(enumSource, /\bDPAD_4DIR\b/);
        assert.match(enumSource, /\bDPAD_8DIR\b/);
        assert.match(consumerSource, /eInputVirtualType\.DPAD_4DIR/);
        assert.match(consumerSource, /eInputVirtualType\.DPAD_8DIR/);
        assert.doesNotMatch(enumSource, /\bDPAD_4_DIR\b/);
        assert.doesNotMatch(enumSource, /\bDPAD_8_DIR\b/);
        assert.doesNotMatch(consumerSource, /\bDPAD_4_DIR\b/);
        assert.doesNotMatch(consumerSource, /\bDPAD_8_DIR\b/);

        await assertProjectGmlFilesParse(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write renames enum references embedded in macro declaration bodies", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        enum: {
                            prefix: "e",
                            caseStyle: "camel"
                        },
                        enumMember: {
                            caseStyle: "upper_snake"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "input_defs",
            [
                "enum INPUT_SOURCE_MODE {",
                "    HOTSWAP,",
                "    MULTIDEVICE",
                "}",
                "",
                "enum INPUT_GYRO {",
                "    AXIS_PITCH,",
                "    AXIS_YAW",
                "}",
                ""
            ].join("\n")
        );
        await writeScriptResource(
            projectRoot,
            "input_config",
            [
                "#macro INPUT_STARTING_SOURCE_MODE  INPUT_SOURCE_MODE.HOTSWAP",
                "#macro INPUT_GYRO_DEFAULT_AXIS_X  INPUT_GYRO.AXIS_YAW",
                "",
                "function input_config() {",
                "    return [INPUT_STARTING_SOURCE_MODE, INPUT_GYRO_DEFAULT_AXIS_X];",
                "}",
                ""
            ].join("\n")
        );
        await writeScriptResource(
            projectRoot,
            "input_player",
            [
                "function input_player() {",
                "    var source_mode = INPUT_STARTING_SOURCE_MODE;",
                "    var gyro_axis = INPUT_GYRO_DEFAULT_AXIS_X;",
                "    return [source_mode, gyro_axis];",
                "}",
                ""
            ].join("\n")
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        const enumSource = await readFile(path.join(projectRoot, "scripts/input_defs/input_defs.gml"), "utf8");
        const configSource = await readFile(path.join(projectRoot, "scripts/input_config/input_config.gml"), "utf8");

        assert.match(enumSource, /enum eInputSourceMode \{/);
        assert.match(enumSource, /enum eInputGyro \{/);
        assert.match(configSource, /#macro INPUT_STARTING_SOURCE_MODE {2}eInputSourceMode\.HOTSWAP/);
        assert.match(configSource, /#macro INPUT_GYRO_DEFAULT_AXIS_X {2}eInputGyro\.AXIS_YAW/);
        assert.doesNotMatch(configSource, /\bINPUT_SOURCE_MODE\.HOTSWAP\b/);
        assert.doesNotMatch(configSource, /\bINPUT_GYRO\.AXIS_YAW\b/);

        await assertProjectGmlFilesParse(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write keeps same-name macros intact when renaming the owning script resource", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        resource: {
                            caseStyle: "lower_snake"
                        },
                        macro: {
                            caseStyle: "upper_snake"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "CM_TRIANGLE_GET_CAPSULE_REF",
            ["#macro CM_TRIANGLE_GET_CAPSULE_REF var refX = X;\\", "var refY = Y;", ""].join("\n")
        );
        await writeScriptResource(
            projectRoot,
            "cm_triangle",
            ["function cm_triangle() {", "    CM_TRIANGLE_GET_CAPSULE_REF;", "    return refX + refY;", "}", ""].join(
                "\n"
            )
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        await access(path.join(projectRoot, "scripts/cm_triangle_get_capsule_ref/cm_triangle_get_capsule_ref.gml"));
        const macroSource = await readFile(
            path.join(projectRoot, "scripts/cm_triangle_get_capsule_ref/cm_triangle_get_capsule_ref.gml"),
            "utf8"
        );
        const consumerSource = await readFile(path.join(projectRoot, "scripts/cm_triangle/cm_triangle.gml"), "utf8");

        assert.match(macroSource, /^#macro CM_TRIANGLE_GET_CAPSULE_REF/m);
        assert.match(consumerSource, /\bCM_TRIANGLE_GET_CAPSULE_REF;/);
        assert.doesNotMatch(macroSource, /^#macro cm_triangle_get_capsule_ref/m);
        assert.doesNotMatch(consumerSource, /\bcm_triangle_get_capsule_ref\b/);

        await assertProjectGmlFilesParse(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write keeps project manifest entries aligned for batched case-only script resource renames", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        resource: {
                            caseStyle: "lower_snake"
                        },
                        macro: {
                            caseStyle: "upper_snake"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "CM_TRIANGLE_GET_CAPSULE_REF",
            ["#macro CM_TRIANGLE_GET_CAPSULE_REF var refX = X;\\", "var refY = Y;", ""].join("\n")
        );
        await writeScriptResource(projectRoot, "Object", "// resource-only script fixture\n");

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);

        const manifestSource = await readFile(path.join(projectRoot, "MyGame.yyp"), "utf8");
        assert.match(
            manifestSource,
            /"name"\s*:\s*"cm_triangle_get_capsule_ref"[\s\S]*"path"\s*:\s*"scripts\/cm_triangle_get_capsule_ref\/cm_triangle_get_capsule_ref\.yy"/u
        );
        assert.match(manifestSource, /"name"\s*:\s*"object"[\s\S]*"path"\s*:\s*"scripts\/object\/object\.yy"/u);
        assert.doesNotMatch(manifestSource, /\bCM_TRIANGLE_GET_CAPSULE_REF\b/u);
        assert.doesNotMatch(manifestSource, /"scripts\/Object\/Object\.yy"/u);

        await access(path.join(projectRoot, "scripts/cm_triangle_get_capsule_ref/cm_triangle_get_capsule_ref.yy"));
        await access(path.join(projectRoot, "scripts/object/object.yy"));
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write keeps reserved built-in local names intact and reparses the rewritten project", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        variable: {
                            caseStyle: "lower_snake"
                        },
                        spriteResourceName: {
                            prefix: "spr_",
                            caseStyle: "lower_snake"
                        }
                    },
                    exclusivePrefixes: {
                        spr_: "spriteResourceName"
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "cm_collider",
            [
                "function cm_collider_check(collider) {",
                "    var X = collider[CM.X];",
                "    var Y = collider[CM.Y];",
                "    var halfX = 1;",
                "    return X + Y + halfX;",
                "}",
                ""
            ].join("\n")
        );
        await writeScriptResource(
            projectRoot,
            "group_smf",
            [
                "function group_smf(path, texName) {",
                '    var spr_id = asset_get_index(filename_change_ext(filename_name(path), "_" + string(texName)));',
                "    return spr_id;",
                "}",
                ""
            ].join("\n")
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        const colliderSource = await readFile(path.join(projectRoot, "scripts/cm_collider/cm_collider.gml"), "utf8");
        const groupSmfSource = await readFile(path.join(projectRoot, "scripts/group_smf/group_smf.gml"), "utf8");

        assert.match(colliderSource, /var X = collider\[CM\.X\];/);
        assert.match(colliderSource, /var Y = collider\[CM\.Y\];/);
        assert.match(colliderSource, /var half_x = 1;/);
        assert.match(colliderSource, /return X \+ Y \+ half_x;/);
        assert.match(groupSmfSource, /var spr_id = asset_get_index/);
        assert.match(groupSmfSource, /string\(tex_name\)/);
        assert.match(groupSmfSource, /return spr_id;/);
        assert.match(result.stdout, /reserved GameMaker identifier/);

        await assertProjectGmlFilesParse(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write skips local renames required by referenced macro expansions and reparses the rewritten project", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        variable: {
                            caseStyle: "lower_snake"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "cm_triangle_get_capsule_ref",
            ["#macro CM_TRIANGLE_GET_CAPSULE_REF var refZ = Z + zup;\\", "var refX = X + xup;", ""].join("\n")
        );
        await writeScriptResource(
            projectRoot,
            "cm_triangle",
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

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        const triangleSource = await readFile(path.join(projectRoot, "scripts/cm_triangle/cm_triangle.gml"), "utf8");

        assert.match(triangleSource, /var X = collider\[0\];/);
        assert.match(triangleSource, /var Z = collider\[1\];/);
        assert.match(triangleSource, /CM_TRIANGLE_GET_CAPSULE_REF;/);
        assert.match(result.stdout, /macro expansion 'CM_TRIANGLE_GET_CAPSULE_REF' depends on 'Z'/);

        await assertProjectGmlFilesParse(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write skips argument renames that would collide with reachable locals and reparses the rewritten project", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        argument: {
                            caseStyle: "lower_snake"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "collision_demo",
            [
                "function collision_demo(M) {",
                "    var m = array_create(16);",
                "    array_copy(m, 0, M, 0, 16);",
                "    return m[0] + M[0];",
                "}",
                "",
                "function cm_spatialhash_get_region(spatialhash, AABB) {",
                "    var aabb = CM_SPATIALHASH_AABB;",
                "    if (is_undefined(aabb)) {",
                "        return AABB[0];",
                "    }",
                "    return aabb[0] + AABB[0];",
                "}",
                "",
                "function stile_bake_center(vbuff, polygon, N) {",
                "    for (var n = array_length(polygon); n > 0; --n) {",
                "        show_debug_message(N.x + n);",
                "    }",
                "}",
                ""
            ].join("\n")
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        const updatedSource = await readFile(
            path.join(projectRoot, "scripts/collision_demo/collision_demo.gml"),
            "utf8"
        );

        assert.match(updatedSource, /function collision_demo\(M\)/);
        assert.match(updatedSource, /array_copy\(m, 0, M, 0, 16\);/);
        assert.match(updatedSource, /function cm_spatialhash_get_region\(spatialhash, AABB\)/);
        assert.match(updatedSource, /return aabb\[0\] \+ AABB\[0\];/);
        assert.match(updatedSource, /function stile_bake_center\(vbuff, polygon, N\)/);
        assert.match(updatedSource, /show_debug_message\(N\.x \+ n\);/);
        assert.match(result.stdout, /already exists in the same scope/);

        await assertProjectGmlFilesParse(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write updates constructor inheritance references when renaming struct declarations", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        structDeclaration: {
                            caseStyle: "pascal"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "buttons",
            [
                "function GUIElement() constructor {}",
                "function Checkbox(_name, _x, _y, _checked) : GUIElement() constructor {}",
                ""
            ].join("\n")
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        const buttonsSource = await readFile(path.join(projectRoot, "scripts/buttons/buttons.gml"), "utf8");

        assert.match(buttonsSource, /function GuiElement\(\) constructor \{\}/);
        assert.match(buttonsSource, /function Checkbox\(_name, _x, _y, _checked\) : GuiElement\(\) constructor \{\}/);

        await assertProjectGmlFilesParse(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write updates constructor runtime type checks for coupled single-callable scripts", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        constructorFunction: {
                            caseStyle: "pascal"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "__input_class_binding",
            "function __input_class_binding() constructor {}\n"
        );
        await writeScriptResource(
            projectRoot,
            "input_binding_empty",
            ["function input_binding_empty() {", "    return new __input_class_binding();", "}", ""].join("\n")
        );
        await writeScriptResource(
            projectRoot,
            "input_value_is_binding",
            [
                "function input_value_is_binding(_value) {",
                "    return is_instanceof(_value, __input_class_binding);",
                "}",
                "",
                "function input_value_is_binding_legacy(_value) {",
                '    return instanceof(_value) == "__input_class_binding";',
                "}",
                ""
            ].join("\n")
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        await access(path.join(projectRoot, "scripts", "__InputClassBinding", "__InputClassBinding.gml"));
        const constructorSource = await readFile(
            path.join(projectRoot, "scripts", "__InputClassBinding", "__InputClassBinding.gml"),
            "utf8"
        );
        const emptyBindingSource = await readFile(
            path.join(projectRoot, "scripts", "input_binding_empty", "input_binding_empty.gml"),
            "utf8"
        );
        const bindingChecksSource = await readFile(
            path.join(projectRoot, "scripts", "input_value_is_binding", "input_value_is_binding.gml"),
            "utf8"
        );

        assert.match(constructorSource, /function __InputClassBinding\(\) constructor \{\}/);
        assert.match(emptyBindingSource, /return new __InputClassBinding\(\);/);
        assert.match(bindingChecksSource, /is_instanceof\(_value, __InputClassBinding\);/);
        assert.match(bindingChecksSource, /instanceof\(_value\) == "__InputClassBinding";/);
        assert.doesNotMatch(bindingChecksSource, /\b__input_class_binding\b/);

        await assertProjectGmlFilesParse(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write does not rename plain functions in mixed multi-callable scripts when only struct declarations are configured", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        structDeclaration: {
                            caseStyle: "pascal"
                        },
                        resource: {
                            caseStyle: "lower_snake"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "GroupSmf",
            [
                "function smf_model() constructor {}",
                "",
                "function smf_model_load(path) {",
                "    return new smf_model();",
                "}",
                ""
            ].join("\n")
        );
        await writeScriptResource(
            projectRoot,
            "use_it",
            ["function use_it() {", '    global.model_player = smf_model_load("Mushroom.smf");', "}", ""].join("\n")
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        await access(path.join(projectRoot, "scripts/group_smf/group_smf.gml"));
        const groupSmfSource = await readFile(path.join(projectRoot, "scripts/group_smf/group_smf.gml"), "utf8");
        const consumerSource = await readFile(path.join(projectRoot, "scripts/use_it/use_it.gml"), "utf8");

        assert.match(groupSmfSource, /function SmfModel\(\) constructor \{\}/);
        assert.match(groupSmfSource, /return new SmfModel\(\);/);
        assert.match(groupSmfSource, /function smf_model_load\(path\)/);
        assert.doesNotMatch(groupSmfSource, /function SmfModelLoad\(path\)/);
        assert.match(consumerSource, /global\.model_player = smf_model_load\("Mushroom\.smf"\);/);
        assert.doesNotMatch(consumerSource, /\bSmfModelLoad\(/);

        await assertProjectGmlFilesParse(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write renames unique constructor static member calls across files", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        staticVariable: {
                            caseStyle: "camel"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "vector2",
            [
                "function Vector2(x, y) constructor {",
                "    self.x = x;",
                "    self.y = y;",
                "",
                "    static Sub = function(val) {",
                "        return new Vector2(self.x - val.x, self.y - val.y);",
                "    };",
                "}",
                ""
            ].join("\n")
        );
        await writeScriptResource(
            projectRoot,
            "movement",
            ["function movement(pos, prev_pos) {", "    return pos.Sub(prev_pos);", "}", ""].join("\n")
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        const vectorSource = await readFile(path.join(projectRoot, "scripts/vector2/vector2.gml"), "utf8");
        const movementSource = await readFile(path.join(projectRoot, "scripts/movement/movement.gml"), "utf8");

        assert.match(vectorSource, /static sub = function\(val\) \{/);
        assert.match(movementSource, /return pos\.sub\(prev_pos\);/);
        assert.doesNotMatch(movementSource, /pos\.Sub\(prev_pos\)/);

        await assertProjectGmlFilesParse(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write renames unique constructor static member bare calls inside constructors and with blocks", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        staticVariable: {
                            caseStyle: "camel"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "generator_state",
            [
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
            ].join("\n")
        );
        await writeScriptResource(
            projectRoot,
            "initialize",
            [
                "function initialize() {",
                "    static _generator_state = generator_state();",
                "    with (_generator_state) {",
                "        Reset();",
                "    }",
                "}",
                ""
            ].join("\n")
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        const stateSource = await readFile(
            path.join(projectRoot, "scripts/generator_state/generator_state.gml"),
            "utf8"
        );
        const initializeSource = await readFile(path.join(projectRoot, "scripts/initialize/initialize.gml"), "utf8");

        assert.match(stateSource, /static reset = function\(\) \{/);
        assert.match(stateSource, /\n {4}reset\(\);\n/u);
        assert.doesNotMatch(stateSource, /\n {4}Reset\(\);\n/u);
        assert.match(initializeSource, /with \(_generatorState\) \{\n {8}reset\(\);\n {4}\}/u);
        assert.doesNotMatch(initializeSource, /\bReset\(\);/);

        await assertProjectGmlFilesParse(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write lets multi-function scripts rename the resource and same-name callable independently", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        scriptResourceName: {
                            caseStyle: "lower_snake"
                        },
                        function: {
                            caseStyle: "camel"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "DemoLibrary",
            [
                "function DemoLibrary() {",
                "    return helper_fn();",
                "}",
                "",
                "function helper_fn() {",
                "    return 1;",
                "}",
                ""
            ].join("\n")
        );
        await writeScriptResource(
            projectRoot,
            "consumer_script",
            "function consumer_script() {\n    return DemoLibrary() + helper_fn();\n}\n"
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        await access(path.join(projectRoot, "scripts/demo_library/demo_library.gml"));
        const renamedLibrarySource = await readFile(
            path.join(projectRoot, "scripts/demo_library/demo_library.gml"),
            "utf8"
        );
        const renamedMetadata = await readFile(path.join(projectRoot, "scripts/demo_library/demo_library.yy"), "utf8");
        const consumerSource = await readFile(
            path.join(projectRoot, "scripts/consumer_script/consumer_script.gml"),
            "utf8"
        );

        assert.match(renamedLibrarySource, /function demoLibrary\(\)/);
        assert.match(renamedLibrarySource, /return helperFn\(\);/);
        assert.match(renamedLibrarySource, /function helperFn\(\)/);
        assert.match(renamedMetadata, /"name"\s*:\s*"demo_library"/);
        assert.match(consumerSource, /return demoLibrary\(\) \+ helperFn\(\);/);
        await assert.rejects(access(path.join(projectRoot, "scripts/DemoLibrary/DemoLibrary.gml")));
        assert.match(result.stdout, /\[namingConvention\] changed/);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write applies configured loop-length hoisting changes", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                loopLengthHoisting: {}
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "demo_script",
            "for (var i = 0; i < array_length(items); i++) {\n    total += i;\n}\n"
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        const updatedSource = await readFile(path.join(projectRoot, "scripts/demo_script/demo_script.gml"), "utf8");
        assert.match(updatedSource, /var len = array_length\(items\);/);
        assert.match(result.stdout, /\[loopLengthHoisting\] changed/);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write skips semantic project indexing when all selected codemods are non-semantic", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                globalvarToGlobal: {},
                loopLengthHoisting: {}
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "demo_script",
            [
                "function demo_script(items) {",
                "    globalvar legacy_score;",
                "    for (var i = 0; i < array_length(items); i++) {",
                "        legacy_score += items[i];",
                "    }",
                "    return legacy_score;",
                "}",
                ""
            ].join("\n")
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write", "--verbose"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /\[globalvarToGlobal\] changed/);
        assert.match(result.stdout, /\[loopLengthHoisting\] changed/);
        assert.doesNotMatch(result.stdout, /DEBUG: Starting buildProjectIndex/);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write only rebuilds the project index between changed codemods", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                loopLengthHoisting: {},
                namingConvention: {
                    rules: {
                        localVariable: {
                            caseStyle: "camel"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "demo_script",
            [
                "function demo_script(items) {",
                "    var bad_name = 0;",
                "    for (var i = 0; i < array_length(items); i++) {",
                "        bad_name += items[i];",
                "    }",
                "    return bad_name;",
                "}",
                ""
            ].join("\n")
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write", "--verbose"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /Rebuilding project index after codemod loopLengthHoisting/);
        assert.doesNotMatch(result.stdout, /Rebuilding project index after codemod namingConvention/);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --write batches semantic index rebuild until all non-semantic codemods finish", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                globalvarToGlobal: {},
                loopLengthHoisting: {},
                namingConvention: {
                    rules: {
                        localVariable: {
                            caseStyle: "camel"
                        }
                    }
                }
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "demo_script",
            [
                "function demo_script(items) {",
                "    globalvar total_score;",
                "    var bad_name = 0;",
                "    for (var i = 0; i < array_length(items); i++) {",
                "        bad_name += items[i] + total_score;",
                "    }",
                "    return bad_name;",
                "}",
                ""
            ].join("\n")
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--write", "--verbose"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /\[globalvarToGlobal\] changed/);
        assert.match(result.stdout, /\[loopLengthHoisting\] changed/);
        assert.match(result.stdout, /\[namingConvention\] changed/);

        const rebuildLines = result.stdout.match(/Rebuilding project index after codemod /g) ?? [];
        assert.equal(rebuildLines.length, 1);
        assert.match(result.stdout, /Rebuilding project index after codemod loopLengthHoisting/);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor infers codemod mode from project config when no rename target is specified", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                loopLengthHoisting: {}
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "demo_script",
            "for (var i = 0; i < array_length(items); i++) {\n    total += i;\n}\n"
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "--path", projectRoot, "--write"]
        });

        assert.equal(result.exitCode, 0);
        const updatedSource = await readFile(path.join(projectRoot, "scripts/demo_script/demo_script.gml"), "utf8");
        assert.match(updatedSource, /var len = array_length\(items\);/);
        assert.match(result.stdout, /\[loopLengthHoisting\] changed/);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod target paths restrict which gml files are rewritten", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                loopLengthHoisting: {}
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "selected_script",
            "for (var i = 0; i < array_length(selected_items); i++) {\n    total += i;\n}\n"
        );
        await writeScriptResource(
            projectRoot,
            "other_script",
            "for (var i = 0; i < array_length(other_items); i++) {\n    total += i;\n}\n"
        );

        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "scripts/selected_script", "--write"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        const selectedSource = await readFile(
            path.join(projectRoot, "scripts/selected_script/selected_script.gml"),
            "utf8"
        );
        const otherSource = await readFile(path.join(projectRoot, "scripts/other_script/other_script.gml"), "utf8");
        assert.match(selectedSource, /var len = array_length\(selected_items\);/);
        assert.doesNotMatch(otherSource, /var len = array_length\(other_items\);/);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod --path accepts a single .gml file and scopes rewrites to that file", async () => {
    const projectRoot = await createSyntheticProject({
        refactor: {
            codemods: {
                loopLengthHoisting: {}
            }
        }
    });

    try {
        await writeScriptResource(
            projectRoot,
            "selected_script",
            "for (var i = 0; i < array_length(selected_items); i++) {\n    total += i;\n}\n"
        );
        await writeScriptResource(
            projectRoot,
            "other_script",
            "for (var i = 0; i < array_length(other_items); i++) {\n    total += i;\n}\n"
        );

        const selectedScriptPath = path.join(projectRoot, "scripts", "selected_script", "selected_script.gml");
        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--path", selectedScriptPath, "--write"]
        });

        assert.equal(result.exitCode, 0);
        const selectedSource = await readFile(
            path.join(projectRoot, "scripts/selected_script/selected_script.gml"),
            "utf8"
        );
        const otherSource = await readFile(path.join(projectRoot, "scripts/other_script/other_script.gml"), "utf8");
        assert.match(selectedSource, /var len = array_length\(selected_items\);/);
        assert.doesNotMatch(otherSource, /var len = array_length\(other_items\);/);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("refactor codemod errors when gmloop.json cannot be found", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-refactor-cli-missing-config-"));
    await writeProjectFile(
        projectRoot,
        "MyGame.yyp",
        `${JSON.stringify({ name: "MyGame", resourceType: "GMProject" }, null, 4)}\n`
    );

    try {
        const result = await runCliTestCommand({
            argv: ["refactor", "codemod", "--list"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, /Could not find gmloop config file/);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});
