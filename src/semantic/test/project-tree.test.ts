import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { scanProjectTree } from "../src/project-index/project-tree.js";

type ProjectTreeFacade = Parameters<typeof scanProjectTree>[1];

function createProjectTreeFacade(
    directories: Map<string, Array<string>>,
    onReadDir?: (directoryPath: string) => void
): ProjectTreeFacade {
    return {
        async readDir(directoryPath: string): Promise<Array<string>> {
            onReadDir?.(directoryPath);
            const entries = directories.get(directoryPath);
            if (!entries) {
                throw Object.assign(new Error(`Missing directory: ${directoryPath}`), { code: "ENOENT" });
            }

            return entries;
        },
        async stat(entryPath: string): Promise<{ isDirectory(): boolean; mtimeMs: number }> {
            const isDirectory = directories.has(entryPath);
            return {
                mtimeMs: 0,
                isDirectory() {
                    return isDirectory;
                }
            };
        }
    };
}

void describe("project-index/project-tree", () => {
    void it("collects source and metadata files while traversing nested directories", async () => {
        const projectRoot = "/project";
        const directories = new Map<string, Array<string>>([
            [projectRoot, ["scripts", "objects", "notes.txt"]],
            [path.join(projectRoot, "scripts"), ["player", "enemy.gml"]],
            [path.join(projectRoot, "scripts", "player"), ["player.gml", "player.yy"]],
            [path.join(projectRoot, "objects"), ["obj_player.yy"]]
        ]);

        const facade = createProjectTreeFacade(directories);

        const result = await scanProjectTree(projectRoot, facade);

        assert.deepStrictEqual(result.gmlFiles, [
            {
                absolutePath: path.join(projectRoot, "scripts", "enemy.gml"),
                relativePath: "scripts/enemy.gml"
            },
            {
                absolutePath: path.join(projectRoot, "scripts", "player", "player.gml"),
                relativePath: "scripts/player/player.gml"
            }
        ]);
        assert.deepStrictEqual(result.yyFiles, [
            {
                absolutePath: path.join(projectRoot, "objects", "obj_player.yy"),
                relativePath: "objects/obj_player.yy"
            },
            {
                absolutePath: path.join(projectRoot, "scripts", "player", "player.yy"),
                relativePath: "scripts/player/player.yy"
            }
        ]);
    });

    void it("skips generated cache and dependency directories while traversing the project tree", async () => {
        const projectRoot = "/project";
        const directories = new Map<string, Array<string>>([
            [projectRoot, [".gmcache", "node_modules", "scripts"]],
            [path.join(projectRoot, ".gmcache"), ["generated.gml", "generated.yy"]],
            [path.join(projectRoot, "node_modules"), ["dependency.gml", "dependency.yy"]],
            [path.join(projectRoot, "scripts"), ["player.gml", "player.yy"]]
        ]);

        const scannedDirectories: Array<string> = [];

        const facade = createProjectTreeFacade(directories, (directoryPath) => {
            scannedDirectories.push(directoryPath);
        });

        const result = await scanProjectTree(projectRoot, facade);

        assert.deepStrictEqual(result.gmlFiles, [
            {
                absolutePath: path.join(projectRoot, "scripts", "player.gml"),
                relativePath: "scripts/player.gml"
            }
        ]);
        assert.deepStrictEqual(result.yyFiles, [
            {
                absolutePath: path.join(projectRoot, "scripts", "player.yy"),
                relativePath: "scripts/player.yy"
            }
        ]);
        assert.deepStrictEqual(scannedDirectories, [projectRoot, path.join(projectRoot, "scripts")]);
    });
});
