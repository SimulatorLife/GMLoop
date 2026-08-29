export type { CreateSolidColorPngRequest, RgbaColor } from "./create-image.js";
export { createSolidColorPng, parseColor } from "./create-image.js";
export type {
    AddObjectEventRequest,
    DeleteObjectEventRequest,
    ObjectEventDescriptor,
    ObjectEventInspectionResult,
    ObjectEventMutationResult,
    ObjectEventParseSummary,
    UpdateObjectEventRequest
} from "./object-event-operations.js";
export {
    addObjectEvent,
    deleteObjectEvent,
    inspectObjectEvent,
    listObjectEvents,
    updateObjectEvent
} from "./object-event-operations.js";
export type { ObjectPropertyMutationResult, UpdateObjectPropertiesRequest } from "./object-property-operations.js";
export { updateObjectProperties } from "./object-property-operations.js";
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
    FrameRoomCameraRequest,
    RoomCameraInspectionResult,
    RoomCameraMutationResult,
    UpdateRoomCameraRequest
} from "./room-camera-operations.js";
export { frameRoomCamera, inspectRoomCamera, listRoomCameras, updateRoomCamera } from "./room-camera-operations.js";
export type {
    AddRoomInstanceRequest,
    DeleteRoomInstanceRequest,
    InspectRoomInstanceRequest,
    ListRoomInstancesRequest,
    RoomInstanceInspectionResult,
    RoomInstanceMutationResult,
    UpdateRoomInstanceRequest
} from "./room-instance-operations.js";
export {
    addRoomInstance,
    deleteRoomInstance,
    inspectRoomInstance,
    listRoomInstances,
    updateRoomInstance
} from "./room-instance-operations.js";
export type {
    CreateRoomLayerRequest,
    DeleteRoomLayerRequest,
    ReorderRoomLayerRequest,
    RoomLayerInspectionResult,
    RoomLayerMutationResult,
    UpdateRoomLayerRequest
} from "./room-layer-operations.js";
export {
    createRoomLayer,
    deleteRoomLayer,
    inspectRoomLayer,
    listRoomLayers,
    reorderRoomLayer,
    updateRoomLayer
} from "./room-layer-operations.js";
export type {
    RepairRoomRequest,
    RoomRepairAppliedRepair,
    RoomRepairDiagnostic,
    RoomRepairResult
} from "./room-repair-operations.js";
export { repairRoom } from "./room-repair-operations.js";
export type { RoomSettingsMutationResult, UpdateRoomSettingsRequest } from "./room-settings-operations.js";
export { updateRoomSettings } from "./room-settings-operations.js";
