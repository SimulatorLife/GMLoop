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

/**
 * Strip every `start` and `end` location property from the AST rooted at
 * {@link target}. Walks the entire object graph (including nested arrays and
 * free-form metadata bags) so every node loses its position information in a
 * single pass. Used when callers don't need positional data and want to shrink
 * the AST's memory footprint or simplify its serialized form.
 *
 * `Object.hasOwn` guards ensure only own properties are removed; inherited
 * `start`/`end` fields are left untouched so prototype pollution cannot
 * accidentally drop keys that some other consumer expects to be present.
 *
 * @param {unknown} target AST node or root value whose location metadata should be removed.
 * @returns {void}
 */
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

/**
 * Collapse verbose location objects into their `index` value. For any node
 * whose `start` or `end` is an object containing a numeric `index`, the
 * property is replaced by that bare number. Nodes that already use the
 * compact number form, or whose location object lacks an `index`, are left
 * as-is so this helper is safe to call on mixed-shape trees.
 *
 * Used by the parser when consumers ask for the compact "offset only"
 * representation, balancing precision against output size. The transform is
 * not idempotent on its own (a plain number is still a valid location), but
 * re-running it is cheap because subsequent calls observe no further change.
 *
 * @param {unknown} target AST node or root value whose verbose locations should be simplified.
 * @returns {void}
 */
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

/**
 * Apply {@link mapIndex} to every numeric location index on the AST rooted at
 * {@link target}. Walks each node and rewrites both the bare-number form
 * (`node.start = 12`) and the object form (`node.start = { index: 12 }`) in
 * place, leaving other location fields untouched.
 *
 * When {@link mapIndex} is omitted or not a function the call is a no-op so
 * callers can pass an optional mapper without first validating it. Used by
 * transforms that inject or remove source text and need to keep downstream
 * location metadata aligned with the post-transform source.
 *
 * @param {unknown} target AST node or root value whose locations should be remapped.
 * @param {(index: number) => number} [mapIndex] Function applied to each
 *        numeric location index. Omit to skip the remap entirely.
 * @returns {void}
 */
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
