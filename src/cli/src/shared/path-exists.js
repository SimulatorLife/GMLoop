import fs from "node:fs";
import fsPromises from "node:fs/promises";

export async function pathExists(filePath, predicate) {
    try {
        const stat = await fsPromises.stat(filePath);
        return predicate ? predicate(stat) : true;
    } catch {
        return false;
    }
}

export function pathExistsSync(filePath, predicate) {
    try {
        const stat = fs.statSync(filePath);
        return predicate ? predicate(stat) : true;
    } catch {
        return false;
    }
}
