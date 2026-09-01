/**
 * Workspace overlay collaborator for {@link GmlSemanticBridge}.
 *
 * Owns the staged file-rename/path-resolution overlay used while composing
 * batch rename plans: it lets later renames in a batch "see" the effect of
 * earlier renames staged in the same plan (both on-disk paths and paths that
 * only exist because an earlier plan step will create them) without touching
 * the filesystem.
 */

import * as fs from "node:fs";
import path from "node:path";

import { pathExistsSync } from "../../shared/path-exists.js";
import type { ProjectMetadataMutationContext } from "./project-metadata-mutation.js";

export class SemanticBridgeWorkspaceOverlay {
    private readonly stagedFileRenames: Array<{ newPath: string; oldPath: string }> = [];

    constructor(
        private readonly projectRoot: string,
        private readonly projectMetadataMutation: ProjectMetadataMutationContext
    ) {}

    /**
     * Reset the staged workspace overlay used while composing batch rename plans.
     */
    clear(): void {
        this.stagedFileRenames.length = 0;
        this.projectMetadataMutation.clear();
    }

    /**
     * Stage metadata rewrites from a planned workspace edit so subsequent rename
     * planning can build on the already-planned metadata state.
     */
    stageWorkspaceEdit(workspace: {
        fileRenames?: Array<{ newPath: string; oldPath: string }>;
        metadataEdits?: Array<{ content: string; path: string }>;
    }): void {
        if (Array.isArray(workspace.fileRenames)) {
            for (const fileRename of workspace.fileRenames) {
                if (typeof fileRename.oldPath !== "string" || typeof fileRename.newPath !== "string") {
                    continue;
                }

                this.stagedFileRenames.push({
                    oldPath: fileRename.oldPath,
                    newPath: fileRename.newPath
                });
            }
        }

        if (!Array.isArray(workspace.metadataEdits)) {
            return;
        }

        for (const metadataEdit of workspace.metadataEdits) {
            this.projectMetadataMutation.stageMetadataEdit(metadataEdit);
        }
    }

    canPlanRenameBatchWithoutOverlay(renames: ReadonlyArray<{ newName: string; symbolId: string }>): boolean {
        return renames.every((rename) => rename.symbolId.startsWith("gml/script/"));
    }

    resolveOverlayPath(candidatePath: string): string {
        let resolvedPath = candidatePath;

        for (const fileRename of this.stagedFileRenames) {
            if (resolvedPath === fileRename.oldPath) {
                resolvedPath = fileRename.newPath;
                continue;
            }

            if (!resolvedPath.startsWith(`${fileRename.oldPath}/`)) {
                continue;
            }

            resolvedPath = `${fileRename.newPath}${resolvedPath.slice(fileRename.oldPath.length)}`;
        }

        return resolvedPath;
    }

    resolveSourcePath(candidatePath: string): string {
        let resolvedPath = candidatePath;

        for (let index = this.stagedFileRenames.length - 1; index >= 0; index -= 1) {
            const fileRename = this.stagedFileRenames[index];
            if (!fileRename) {
                continue;
            }

            if (resolvedPath === fileRename.newPath) {
                resolvedPath = fileRename.oldPath;
                continue;
            }

            if (!resolvedPath.startsWith(`${fileRename.newPath}/`)) {
                continue;
            }

            resolvedPath = `${fileRename.oldPath}${resolvedPath.slice(fileRename.newPath.length)}`;
        }

        return resolvedPath;
    }

    doesFilePathExist(candidatePath: string): boolean {
        const absoluteCandidatePath = path.resolve(this.projectRoot, candidatePath);
        if (pathExistsSync(absoluteCandidatePath)) {
            return true;
        }

        const sourcePath = this.resolveSourcePath(candidatePath);
        if (sourcePath === candidatePath) {
            return false;
        }

        const absoluteSourcePath = path.resolve(this.projectRoot, sourcePath);
        return pathExistsSync(absoluteSourcePath);
    }

    /**
     * Check whether a directory path exists in the effective workspace view.
     * This considers both on-disk paths and staged rename overlays so batch
     * rename planning can treat already-staged destinations as existing.
     */
    doesDirectoryPathExist(candidatePath: string): boolean {
        const absoluteCandidatePath = path.resolve(this.projectRoot, candidatePath);
        if (pathExistsSync(absoluteCandidatePath, (stat) => stat.isDirectory())) {
            return true;
        }

        const sourcePath = this.resolveSourcePath(candidatePath);
        if (sourcePath === candidatePath) {
            return false;
        }

        const absoluteSourcePath = path.resolve(this.projectRoot, sourcePath);
        return pathExistsSync(absoluteSourcePath, (stat) => stat.isDirectory());
    }

    listDirectoryEntries(candidatePath: string): Array<string> {
        const absoluteCandidatePath = path.resolve(this.projectRoot, candidatePath);
        if (pathExistsSync(absoluteCandidatePath, (stat) => stat.isDirectory())) {
            return fs.readdirSync(absoluteCandidatePath);
        }

        const sourcePath = this.resolveSourcePath(candidatePath);
        if (sourcePath === candidatePath) {
            return [];
        }

        const absoluteSourcePath = path.resolve(this.projectRoot, sourcePath);
        if (!pathExistsSync(absoluteSourcePath, (stat) => stat.isDirectory())) {
            return [];
        }

        return fs.readdirSync(absoluteSourcePath);
    }
}
