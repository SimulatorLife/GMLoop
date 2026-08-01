import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function withTempProject(testName: string, run: (projectRoot: string) => Promise<void>): Promise<void> {
    const projectRoot = await mkdtemp(path.join(tmpdir(), `gmloop-${testName}-`));
    await writeFile(path.join(projectRoot, "gmloop.json"), "{}\n", "utf8");
    try {
        await run(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
}
