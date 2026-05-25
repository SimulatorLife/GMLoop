import type { GraphVisualizationEdgeType, GraphVisualizationNodeKind } from "./types.js";

type EdgeLineVisualStyle = Readonly<{
    color: string;
    dashArray: string;
    legendBorderStyle: "dashed" | "dotted" | "solid";
    legendBorderWidth: string;
    strokeLineCap: "butt" | "round";
    strokeWidth: string;
    type: GraphVisualizationEdgeType;
}>;

type NodeVisualStyle = Readonly<{
    color: string;
    kind: GraphVisualizationNodeKind | "default";
}>;

export const EDGE_LINE_VISUAL_STYLES: ReadonlyArray<EdgeLineVisualStyle> = Object.freeze([
    {
        color: "#1f77b4",
        dashArray: "none",
        legendBorderStyle: "solid",
        legendBorderWidth: "2px",
        strokeLineCap: "butt",
        strokeWidth: "1.5px",
        type: "calls"
    },
    {
        color: "#999",
        dashArray: "4,4",
        legendBorderStyle: "dashed",
        legendBorderWidth: "1px",
        strokeLineCap: "butt",
        strokeWidth: "1px",
        type: "references"
    },
    {
        color: "#2ca02c",
        dashArray: "1,4",
        legendBorderStyle: "dotted",
        legendBorderWidth: "2px",
        strokeLineCap: "round",
        strokeWidth: "1.5px",
        type: "contains"
    },
    {
        color: "#f2c94c",
        dashArray: "none",
        legendBorderStyle: "solid",
        legendBorderWidth: "2px",
        strokeLineCap: "butt",
        strokeWidth: "2px",
        type: "defines"
    },
    {
        color: "#d62728",
        dashArray: "none",
        legendBorderStyle: "solid",
        legendBorderWidth: "2px",
        strokeLineCap: "butt",
        strokeWidth: "2px",
        type: "inherits"
    },
    {
        color: "#ff7f0e",
        dashArray: "4,4",
        legendBorderStyle: "dashed",
        legendBorderWidth: "1px",
        strokeLineCap: "butt",
        strokeWidth: "1px",
        type: "uses_toolset"
    },
    {
        color: "#7f7f7f",
        dashArray: "none",
        legendBorderStyle: "solid",
        legendBorderWidth: "2px",
        strokeLineCap: "butt",
        strokeWidth: "1.5px",
        type: "depends_on"
    },
    {
        color: "#9467bd",
        dashArray: "2,2",
        legendBorderStyle: "dashed",
        legendBorderWidth: "1px",
        strokeLineCap: "butt",
        strokeWidth: "1px",
        type: "placed_in_room"
    }
]);

export const NODE_VISUAL_STYLES: ReadonlyArray<NodeVisualStyle> = Object.freeze([
    { color: "#f8f9fa", kind: "project" },
    { color: "#e76f51", kind: "anim_curve" },
    { color: "#9aa0a6", kind: "data_file" },
    { color: "#7f5539", kind: "extension" },
    { color: "#6c757d", kind: "file" },
    { color: "#f4a261", kind: "font" },
    { color: "#4dabf7", kind: "function" },
    { color: "#1f78b4", kind: "script" },
    { color: "#2a9d8f", kind: "object" },
    { color: "#9b5de5", kind: "enum" },
    { color: "#c77dff", kind: "enum_member" },
    { color: "#f77f00", kind: "macro" },
    { color: "#ffbe0b", kind: "note" },
    { color: "#f15bb5", kind: "struct" },
    { color: "#ff70a6", kind: "struct_variable" },
    { color: "#d81159", kind: "constructor" },
    { color: "#00b4d8", kind: "global_variable" },
    { color: "#00f5d4", kind: "instance_variable" },
    { color: "#90e0ef", kind: "local_variable" },
    { color: "#ef476f", kind: "particle_system" },
    { color: "#06d6a0", kind: "path" },
    { color: "#adb5bd", kind: "resource" },
    { color: "#ff7f11", kind: "sprite" },
    { color: "#ffd166", kind: "shader" },
    { color: "#8ecae6", kind: "sequence" },
    { color: "#3a86ff", kind: "sound" },
    { color: "#e63946", kind: "room" },
    { color: "#c77dff", kind: "room_layer" },
    { color: "#8ac926", kind: "tileset" },
    { color: "#cdb4db", kind: "timeline" },
    { color: "#bcbd22", kind: "object_event" },
    { color: "#7f7f7f", kind: "default" }
]);

function renderEdgeLineCssRule(style: EdgeLineVisualStyle): string {
    const declarations = [`stroke: ${style.color};`, `stroke-width: ${style.strokeWidth};`];

    if (style.dashArray !== "none") {
        declarations.push(`stroke-dasharray: ${style.dashArray};`);
    }

    if (style.strokeLineCap !== "butt") {
        declarations.push(`stroke-linecap: ${style.strokeLineCap};`);
    }

    return `.link-${style.type} { ${declarations.join(" ")} }`;
}

export function renderEdgeLineCssRules(): string {
    return EDGE_LINE_VISUAL_STYLES.map((style) => renderEdgeLineCssRule(style)).join("\n    ");
}

export function getEdgeLineColor(type: GraphVisualizationEdgeType): string {
    const visualStyle = EDGE_LINE_VISUAL_STYLES.find((style) => style.type === type);
    return visualStyle?.color ?? "#7f7f7f";
}

function renderNodeFillCssRule(style: NodeVisualStyle): string {
    return `.node-${style.kind} { fill: ${style.color}; }`;
}

export function renderNodeFillCssRules(): string {
    return NODE_VISUAL_STYLES.map((style) => renderNodeFillCssRule(style)).join("\n    ");
}
