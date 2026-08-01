import path from "node:path";

import { Core } from "@gmloop/core";

import { buildProjectIndex } from "../builder.js";
import { createSemanticProjectSession, type SemanticProjectIndexBuilder } from "./project-session.js";
import type { SemanticProjectService, SemanticProjectServiceOptions, SemanticProjectSession } from "./types.js";

/** Create the canonical semantic project service for normalized project-root sessions. */
export function createProjectService(options: SemanticProjectServiceOptions = {}): SemanticProjectService {
    return createProjectServiceWithBuilder(options, buildProjectIndex);
}

/** Create a semantic project service with an injected internal builder for focused lifecycle tests. */
export function createProjectServiceWithBuilder(
    options: SemanticProjectServiceOptions,
    buildIndex: SemanticProjectIndexBuilder
): SemanticProjectService {
    const fsFacade = options.fsFacade ?? Core.defaultFsFacade;
    const sessions = new Map<string, SemanticProjectSession>();
    let closePromise: Promise<void> | null = null;
    let closed = false;
    return Object.freeze({
        close(): Promise<void> {
            if (closePromise !== null) {
                return closePromise;
            }
            closed = true;
            const sessionsAtClose = [...sessions.values()];
            closePromise = Promise.all(sessionsAtClose.map((session) => session.close())).then(() => sessions.clear());
            return closePromise;
        },
        openProject(projectRoot: string) {
            if (closed) {
                throw new Error("Semantic project service is closed.");
            }
            const normalizedRoot = path.resolve(projectRoot);
            const existing = sessions.get(normalizedRoot);
            if (existing !== undefined) {
                return existing;
            }
            const session: SemanticProjectSession = createSemanticProjectSession({
                buildIndex,
                fsFacade,
                onClose: () => {
                    if (sessions.get(normalizedRoot) === session) {
                        sessions.delete(normalizedRoot);
                    }
                },
                projectRoot: normalizedRoot
            });
            sessions.set(normalizedRoot, session);
            return session;
        }
    });
}
