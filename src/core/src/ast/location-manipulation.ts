import { walkObjectGraph } from "./object-graph.js";

type LocationKey = "start" | "end";

type LocationValue =
    | number
    | {
          index?: number;
      }
    | null
    | undefined;

type LocationNode = Record<string, LocationValue>;

function adjustLocationProperty(node: LocationNode, propertyName: LocationKey, mapIndex: (index: number) => number) {
    if (!Object.hasOwn(node, propertyName)) {
        return;
    }

    const location = node[propertyName];

    if (typeof location === "number") {
        node[propertyName] = mapIndex(location);
        return;
    }

    if (!location || typeof location !== "object") {
        return;
    }

    const locationObject = location;
    if (typeof locationObject.index === "number") {
        locationObject.index = mapIndex(locationObject.index);
    }
}

export function removeLocationMetadata(target: unknown) {
    walkObjectGraph(target, {
        enterObject(node) {
            if (Object.hasOwn(node, "start")) {
                delete node.start;
            }

            if (Object.hasOwn(node, "end")) {
                delete node.end;
            }
        }
    });
}

export function simplifyLocationMetadata(target: unknown) {
    walkObjectGraph(target, {
        enterObject(node) {
            if (Object.hasOwn(node, "start")) {
                const start = node.start;
                if (start && typeof start === "object" && "index" in start) {
                    node.start = (start as { index?: number }).index;
                }
            }

            if (Object.hasOwn(node, "end")) {
                const end = node.end;
                if (end && typeof end === "object" && "index" in end) {
                    node.end = (end as { index?: number }).index;
                }
            }
        }
    });
}

export function remapLocationMetadata(target: unknown, mapIndex?: (index: number) => number) {
    if (typeof mapIndex !== "function") {
        return;
    }

    walkObjectGraph(target, {
        enterObject(node) {
            adjustLocationProperty(node, "start", mapIndex);
            adjustLocationProperty(node, "end", mapIndex);
        }
    });
}
