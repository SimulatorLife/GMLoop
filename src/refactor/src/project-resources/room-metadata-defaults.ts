/**
 * Create a default GameMaker room view record.
 *
 * @returns A mutable metadata record matching the default view shape GMLoop creates for new rooms.
 */
export function createDefaultRoomView(): Record<string, number | boolean | null> {
    return {
        hborder: 32,
        hport: 768,
        hspeed: -1,
        hview: 768,
        inherit: false,
        objectId: null,
        vborder: 32,
        visible: false,
        vspeed: -1,
        wport: 1024,
        wview: 1024,
        xport: 0,
        xview: 0,
        yport: 0,
        yview: 0
    };
}

/**
 * Create the default eight GameMaker room view records.
 *
 * @returns Mutable metadata records for all default room views.
 */
export function createDefaultRoomViews(): Array<Record<string, number | boolean | null>> {
    return Array.from({ length: 8 }, () => createDefaultRoomView());
}

/**
 * Create a default GameMaker instance layer record.
 *
 * @param layerName - Layer name to store in both GameMaker name fields.
 * @param depth - Layer depth.
 * @returns A mutable instance layer metadata record.
 */
export function createDefaultInstanceLayer(layerName: string, depth: number): Record<string, unknown> {
    return {
        $GMRInstanceLayer: "",
        "%Name": layerName,
        depth,
        effectEnabled: true,
        effectType: null,
        gridX: 32,
        gridY: 32,
        hierarchyFrozen: false,
        inheritLayerDepth: false,
        inheritLayerSettings: false,
        inheritSubLayers: true,
        inheritVisibility: true,
        instances: [],
        layers: [],
        name: layerName,
        properties: [],
        resourceType: "GMRInstanceLayer",
        resourceVersion: "2.0",
        userdefinedDepth: false,
        visible: true
    };
}
