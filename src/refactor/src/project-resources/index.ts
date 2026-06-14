export type {
    AddObjectEventRequest,
    DeleteObjectEventRequest,
    ObjectEventDescriptor,
    ObjectEventMutationResult,
    UpdateObjectEventRequest
} from "./object-event-operations.js";
export { addObjectEvent, deleteObjectEvent, updateObjectEvent } from "./object-event-operations.js";
export type { ProjectResourceKindValue } from "./project-resource-kinds.js";
export {
    isProjectResourceKind,
    parseProjectResourceKind,
    ProjectResourceKind,
    requireProjectResourceKind
} from "./project-resource-kinds.js";
export type {
    AddProjectResourceRequest,
    DuplicateProjectResourceRequest,
    MoveProjectResourceRequest,
    ProjectManifestEntry,
    ProjectResourceMutationResult,
    RemoveProjectResourceRequest,
    RenameProjectResourceRequest
} from "./project-resource-operations.js";
export {
    addProjectResource,
    duplicateProjectResource,
    getManifestResources,
    moveProjectResource,
    readProjectMetadataDocument,
    removeProjectResource,
    renameProjectResource,
    resolveProjectManifestFile
} from "./project-resource-operations.js";
export type {
    AddRoomInstanceRequest,
    DeleteRoomInstanceRequest,
    RoomInstanceMutationResult,
    UpdateRoomInstanceRequest
} from "./room-instance-operations.js";
export { addRoomInstance, deleteRoomInstance, updateRoomInstance } from "./room-instance-operations.js";
