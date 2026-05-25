export type {
    CopiedExternalProjectFixture,
    ExternalProjectCopyOptions,
    JsonCliPayload,
    ProjectChangeSummary,
    ProjectFileFingerprint,
    ProjectFingerprint
} from "./project-fixtures.js";
export {
    assertJsonCliPayload,
    collectProjectChangeSummary,
    copyExternalProjectFixture,
    createProjectFingerprint,
    DEFAULT_EXTERNAL_PROJECT_EXCLUDES,
    formatProjectChangeSummary,
    parseJsonCliPayload
} from "./project-fixtures.js";
