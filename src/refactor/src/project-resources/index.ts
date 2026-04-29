export type { ProjectResourceKindValue } from "./project-resource-kinds.js";
export {
    isProjectResourceKind,
    parseProjectResourceKind,
    ProjectResourceKind,
    requireProjectResourceKind
} from "./project-resource-kinds.js";
export type {
    AddProjectResourceRequest,
    ProjectResourceMutationResult,
    RemoveProjectResourceRequest
} from "./project-resource-operations.js";
export { addProjectResource, removeProjectResource } from "./project-resource-operations.js";
