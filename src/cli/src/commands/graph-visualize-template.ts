type EdgeLineVisualStyle = Readonly<{
    color: string;
    dashArray: string;
    legendBorderStyle: "dashed" | "dotted" | "solid";
    legendBorderWidth: string;
    strokeLineCap: "butt" | "round";
    strokeWidth: string;
    type: string;
}>;

type NodeVisualStyle = Readonly<{
    color: string;
    kind: string;
}>;

const EDGE_LINE_VISUAL_STYLES: ReadonlyArray<EdgeLineVisualStyle> = Object.freeze([
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

const NODE_VISUAL_STYLES: ReadonlyArray<NodeVisualStyle> = Object.freeze([
    { color: "#f8f9fa", kind: "project" },
    { color: "#e76f51", kind: "anim_curve" },
    { color: "#9aa0a6", kind: "data_file" },
    { color: "#7f5539", kind: "extension" },
    { color: "#f4a261", kind: "font" },
    { color: "#4dabf7", kind: "function" },
    { color: "#1f78b4", kind: "script" },
    { color: "#74c0fc", kind: "script_resource" },
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

function renderEdgeLineCssRules(): string {
    return EDGE_LINE_VISUAL_STYLES.map((style) => renderEdgeLineCssRule(style)).join("\n    ");
}

function getEdgeLineColor(type: string): string {
    const visualStyle = EDGE_LINE_VISUAL_STYLES.find((style) => style.type === type);
    return visualStyle?.color ?? "#7f7f7f";
}

function renderNodeFillCssRule(style: NodeVisualStyle): string {
    return `.node-${style.kind} { fill: ${style.color}; }`;
}

function renderNodeFillCssRules(): string {
    return NODE_VISUAL_STYLES.map((style) => renderNodeFillCssRule(style)).join("\n    ");
}

export function renderGraphVisualizationHtml(dataJson: string, title: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GMLoop Graph Index - ${title}</title>
  <style>
    body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; font-family: system-ui, sans-serif; background: #1e1e1e; color: #e0e0e0; }
    header { position: absolute; top: 0; left: 0; right: 0; padding: 10px 20px; background: #252526; box-shadow: 0 1px 3px rgba(0,0,0,0.5); z-index: 10; display: flex; gap: 15px; align-items: center; }
    h1 { margin: 0; font-size: 16px; font-weight: 600; color: #e0e0e0; }
    #search { padding: 4px 8px; border: 1px solid #555; border-radius: 4px; font-size: 14px; width: 200px; background: #333; color: #eee; }
    button { padding: 4px 10px; border: 1px solid #555; border-radius: 4px; background: #333; color: #eee; cursor: pointer; font-size: 14px; }
    button:hover { background: #444; }
    main { width: 100%; height: 100%; }
    svg { width: 100%; height: 100%; cursor: grab; }
    svg:active { cursor: grabbing; }
    
    .node { stroke: #1e1e1e; stroke-width: 1.5px; cursor: pointer; }
    .node.toolset { stroke-dasharray: 2,2; stroke: #aaa; stroke-width: 2px; }
    .node.dimmed { opacity: 0.1 !important; }
    .node.highlighted { stroke: #fff; stroke-width: 3px; }
    
    .link { stroke-opacity: 0.6; fill: none; }
    .link.dimmed { stroke-opacity: 0.05 !important; }
    
    /* Edge colors */
    ${renderEdgeLineCssRules()}
    
    /* Node colors */
    ${renderNodeFillCssRules()}
    
    text { font-size: 10px; pointer-events: none; fill: #e0e0e0; text-shadow: 0 1px 2px #1e1e1e, 0 -1px 2px #1e1e1e, 1px 0 2px #1e1e1e, -1px 0 2px #1e1e1e; }
    
    #tooltip { position: absolute; background: #252526; padding: 10px; border: 1px solid #444; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.5); pointer-events: auto; font-size: 12px; line-height: 1.35; z-index: 20; width: max-content; max-width: min(520px, calc(100vw - 24px)); box-sizing: border-box; overflow-wrap: anywhere; word-break: normal; white-space: normal; display: none; color: #eee; user-select: text; }
    #tooltip.visible { display: block; }
    #tooltip h3 { margin: 0 0 5px 0; font-size: 14px; overflow-wrap: anywhere; word-break: normal; color: #fff; }
    #tooltip div, #tooltip p { overflow-wrap: anywhere; }
    #tooltip p { margin: 8px 0 0 0; }
    #json-view { position: absolute; inset: 58px 0 0 0; overflow: auto; margin: 0; padding: 10px 20px 20px; font-size: 12px; background: #181818; color: #eaeaea; display: none; }
    .hidden { display: none !important; }
    
    #legend { position: absolute; bottom: 20px; right: 20px; background: rgba(37, 37, 38, 0.9); padding: 10px; border: 1px solid #444; border-radius: 4px; font-size: 12px; z-index: 10; color: #eee; max-height: 80%; overflow-y: auto; }
    
    .filter-item { display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; margin-top: 2px; }
    .filter-section { margin-bottom: 10px; }
    .filter-section strong { display: block; margin-bottom: 5px; cursor: pointer; }
    .sub-filter { margin-left: 15px; }
    
    /* Marker definitions */
  </style>
  <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
</head>
<body>
  <header>
    <h1>Graph Index</h1>
    <input type="search" id="search" placeholder="Search nodes…" />
    <button id="toggle-view">JSON</button>
    <button id="toggle-labels">Labels: Auto</button>
    <button id="reset-default">Reset</button>
  </header>
  <main>
    <svg id="graph">
      <defs>
        <!-- Arrow markers -->
        <marker id="arrow-calls" viewBox="0 -5 10 10" refX="18" refY="0" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,-5L10,0L0,5" fill="${getEdgeLineColor("calls")}"></path></marker>
        <marker id="arrow-inherits" viewBox="0 -5 10 10" refX="20" refY="0" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,-5L10,0L0,5" fill="${getEdgeLineColor("inherits")}"></path></marker>
        <marker id="arrow-depends_on" viewBox="0 -5 10 10" refX="18" refY="0" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,-5L10,0L0,5" fill="${getEdgeLineColor("depends_on")}"></path></marker>
      </defs>
      <g id="container"></g>
    </svg>
    <div id="tooltip"></div>
    <pre id="json-view"></pre>
    <aside id="legend">
        <!-- Rendered by JS -->
    </aside>
  </main>
  <script>
    const DATA = ${dataJson};
    
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    const svg = d3.select("#graph");
    const jsonView = d3.select("#json-view");
    const container = d3.select("#container");
    const tooltip = d3.select("#tooltip");
    let labelMode = "auto";
    let activeView = "visual";
    const edgeLineVisualStyles = ${JSON.stringify(EDGE_LINE_VISUAL_STYLES)};
    const edgeLineVisualStyleByType = new Map(edgeLineVisualStyles.map((style) => [style.type, style]));
    
    // Setup Zoom
    const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on("zoom", (e) => {
            container.attr("transform", e.transform);
            
            // Progressive label rendering
            if (labelMode === "on") {
                nodeLabels.style("display", "block");
            } else if (labelMode === "off") {
                nodeLabels.style("display", "none");
            } else if (e.transform.k > 0.8) {
                nodeLabels.style("display", "block");
            } else {
                nodeLabels.style("display", "none");
            }
        });
        
    svg.call(zoom);

    d3.select("#toggle-view").on("click", () => {
        activeView = activeView === "visual" ? "json" : "visual";
        const isVisualView = activeView === "visual";
        svg.classed("hidden", !isVisualView);
        d3.select("#legend").classed("hidden", !isVisualView);
        d3.select("#tooltip").classed("hidden", !isVisualView);
        jsonView.classed("hidden", isVisualView).style("display", isVisualView ? "none" : "block");
        d3.select("#toggle-view").text(isVisualView ? "JSON" : "Visual");
        if (!isVisualView) {
            jsonView.text(JSON.stringify({
                graphs: DATA.graphs,
                nodes: nodesRaw.filter((nodeValue) => activeNodeFilters.has(nodeValue.kind)),
                edges: linksRaw.filter((edgeValue) => activeFilters.has(edgeValue.type))
            }, null, 2));
        }
    });

    d3.select("#toggle-labels").on("click", () => {
        if (labelMode === "auto") {
            labelMode = "on";
        } else if (labelMode === "on") {
            labelMode = "off";
        } else {
            labelMode = "auto";
        }
        d3.select("#toggle-labels").text(
            labelMode === "auto" ? "Labels: Auto" : labelMode === "on" ? "Labels: On" : "Labels: Off"
        );
        const currentTransform = d3.zoomTransform(svg.node());
        if (labelMode === "on") {
            nodeLabels.style("display", "block");
        } else if (labelMode === "off") {
            nodeLabels.style("display", "none");
        } else {
            nodeLabels.style("display", currentTransform.k > 0.8 ? "block" : "none");
        }
    });
    
    d3.select("#reset-default").on("click", () => {
       svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
       if (typeof clearFocus === 'function') clearFocus();
       
       // Reset filters
       activeFilters = new Set(edgeTypes);
       activeNodeFilters = new Set(defaultEnabledNodeKinds);
       d3.selectAll("#legend input[type='checkbox']").property("indeterminate", false);
       allNodeKinds.forEach((kindValue) => {
            d3.select(\`#filter-node-\${kindValue}\`).property("checked", defaultEnabledNodeKinds.includes(kindValue));
       });
       edgeTypes.forEach((edgeTypeValue) => {
            d3.select(\`#filter-edge-\${edgeTypeValue}\`).property("checked", true);
       });
       syncGroupCheckboxState(resourceCheckbox, resourceTypesPresent);
       syncGroupCheckboxState(enumCheckbox, enumTypesPresent);
       
       updateGraph();
    });
    
    // Performance guardrails
    if (DATA.nodes.length > 2000) {
        console.warn("Large graph detected:", DATA.nodes.length, "nodes. Adjusting rendering parameters.");
    }
    
    // Extract filters
    const edgeTypes = Array.from(new Set(DATA.edges.map(e => e.type)));
    let activeFilters = new Set(edgeTypes);
    
    const allNodes = DATA.nodes.filter((nodeValue) => nodeValue.kind !== "file");
    const allNodeKinds = Array.from(new Set(allNodes.map((nodeValue) => nodeValue.kind)));

    const resourceKinds = new Set([
        "anim_curve",
        "data_file",
        "extension",
        "font",
        "note",
        "object",
        "particle_system",
        "path",
        "resource",
        "room",
        "script_resource",
        "sequence",
        "shader",
        "sound",
        "sprite",
        "tileset",
        "timeline"
    ]);
    const variableKinds = new Set(["global_variable", "instance_variable", "local_variable", "struct_variable"]);
    const defaultDisabledNodeKinds = new Set([
        "data_file",
        "enum_member",
        "function",
        "global_variable",
        "instance_variable",
        "local_variable",
        "struct_variable"
    ]);
    const defaultEnabledNodeKinds = allNodeKinds.filter((kindValue) => !defaultDisabledNodeKinds.has(kindValue));
    const resourceTypesPresent = allNodeKinds.filter((kindValue) => resourceKinds.has(kindValue));
    const enumTypesPresent = allNodeKinds.filter((kindValue) => kindValue === "enum" || kindValue === "enum_member");
    const otherTypesPresent = allNodeKinds.filter(
        (kindValue) => !resourceKinds.has(kindValue) && kindValue !== "enum" && kindValue !== "enum_member"
    );
    let activeNodeFilters = new Set(defaultEnabledNodeKinds);

    function isNodeGroupCheckedByDefault(typeVal) {
        if (typeVal === "resource-group") {
            return resourceTypesPresent.length > 0 && resourceTypesPresent.every((kindValue) => defaultEnabledNodeKinds.includes(kindValue));
        }
        if (typeVal === "enum-group") {
            return enumTypesPresent.length > 0 && enumTypesPresent.every((kindValue) => defaultEnabledNodeKinds.includes(kindValue));
        }
        return defaultEnabledNodeKinds.includes(typeVal);
    }

    function createInitialFilterCheckedState(category, typeVal) {
        if (category === "edge") {
            return true;
        }
        if (category === "node-group") {
            return isNodeGroupCheckedByDefault(typeVal);
        }
        return defaultEnabledNodeKinds.includes(typeVal);
    }

    function syncGroupCheckboxState(checkbox, childKinds) {
        if (!checkbox || childKinds.length === 0) {
            return;
        }

        const enabledChildCount = childKinds.filter((kindValue) => activeNodeFilters.has(kindValue)).length;
        checkbox.property("checked", enabledChildCount === childKinds.length);
        checkbox.property("indeterminate", enabledChildCount > 0 && enabledChildCount < childKinds.length);
    }

    function createFilterCheckbox(container, id, labelText, category, typeVal, changeHandler, customClass="") {
        const wrap = container.append("label").attr("class", \`filter-item \${customClass}\`);
        const checkbox = wrap.append("input")
            .attr("type", "checkbox")
            .attr("id", id)
            .attr("checked", createInitialFilterCheckedState(category, typeVal))
            .on("change", function() {
                changeHandler(this.checked, typeVal);
                updateGraph();
            });
        
        if (category === 'node' || category === 'node-group') {
             let color = "#7f7f7f"; // default
             if (typeVal === 'script') color = "#1f77b4";
             else if (typeVal === 'script_resource') color = "#5c9bd8";
             else if (typeVal === 'object') color = "#2ca02c";
             else if (typeVal === 'enum') color = "#9467bd";
             else if (typeVal === 'macro') color = "#ff7f0e";
             else if (typeVal === 'struct') color = "#e377c2";
             else if (typeVal === 'struct_variable') color = "#c05a94";
             else if (typeVal === 'constructor') color = "#c63fa0";
             else if (typeVal === 'enum_member') color = "#7b61b3";
             else if (typeVal === 'function') color = "#4f8edc";
             else if (variableKinds.has(typeVal)) color = typeVal === "global_variable" ? "#17becf" : typeVal === "local_variable" ? "#5bb7c4" : "#00a2af";
             else if (typeVal === 'object_event') color = "#bcbd22";
             else if (typeVal === 'sprite') color = "#d95f02";
             else if (typeVal === 'sound') color = "#4db6ac";
             else if (typeVal === 'path') color = "#88a764";
             else if (typeVal === 'sequence') color = "#8da0cb";
             else if (typeVal === 'note') color = "#c7b26b";
             else if (typeVal === 'particle_system') color = "#ef8a62";
             else if (typeVal === 'font') color = "#d3a43b";
             else if (typeVal === 'tileset') color = "#66a61e";
             else if (typeVal === 'timeline') color = "#e6ab02";
             else if (typeVal === 'anim_curve') color = "#b65f2a";
             else if (typeVal === 'extension') color = "#6f8f45";
             else if (resourceKinds.has(typeVal)) color = "#8c564b";
             wrap.append("span").html(\`<span style="color:\${color}">■</span> \${labelText}\`);
        } else {
             const visualStyle = edgeLineVisualStyleByType.get(typeVal);
             const strokeStyle = visualStyle
                ? \`border-bottom: \${visualStyle.legendBorderWidth} \${visualStyle.legendBorderStyle} \${visualStyle.color};\`
                : "border-bottom: 2px solid #555;";
             wrap.append("span").html(\`<span style="display:inline-block; width:12px; margin-right:4px; \${strokeStyle}"></span>\${labelText}\`);
        }
        return checkbox;
    }

    const formatLabel = (t) => t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ');

    const legendDiv = d3.select("#legend");
    legendDiv.html("");
    
    // --- Nodes Section ---
    const nodesSection = legendDiv.append("div").attr("class", "filter-section");
    nodesSection.append("strong").text("Nodes");
    
    // Setup resource overarching toggle
    let resourceCheckbox;
    if (resourceTypesPresent.length > 0) {
        resourceCheckbox = createFilterCheckbox(nodesSection, "filter-resource", "Resources", "node-group", "resource-group", (checked) => {
            resourceTypesPresent.forEach(t => {
                checked ? activeNodeFilters.add(t) : activeNodeFilters.delete(t);
                d3.select(\`#filter-node-\${t}\`).property("checked", checked);
            });
        });
        
        resourceTypesPresent.forEach(t => {
            createFilterCheckbox(nodesSection, \`filter-node-\${t}\`, formatLabel(t), "node", t, (checked, val) => {
                checked ? activeNodeFilters.add(val) : activeNodeFilters.delete(val);
                const allResChecked = resourceTypesPresent.every(k => activeNodeFilters.has(k));
                resourceCheckbox.property("checked", allResChecked);
                resourceCheckbox.property("indeterminate", !allResChecked && resourceTypesPresent.some(k => activeNodeFilters.has(k)));
            }, "sub-filter");
        });
        syncGroupCheckboxState(resourceCheckbox, resourceTypesPresent);
    }

    let enumCheckbox;
    if (enumTypesPresent.length > 0) {
        enumCheckbox = createFilterCheckbox(nodesSection, "filter-enum", "Enums", "node-group", "enum-group", (checked) => {
            enumTypesPresent.forEach(t => {
                checked ? activeNodeFilters.add(t) : activeNodeFilters.delete(t);
                d3.select(\`#filter-node-\${t}\`).property("checked", checked);
            });
        });

        enumTypesPresent.forEach(t => {
            createFilterCheckbox(nodesSection, \`filter-node-\${t}\`, formatLabel(t), "node", t, (checked, val) => {
                checked ? activeNodeFilters.add(val) : activeNodeFilters.delete(val);
                const allEnumChecked = enumTypesPresent.every(k => activeNodeFilters.has(k));
                enumCheckbox.property("checked", allEnumChecked);
                enumCheckbox.property("indeterminate", !allEnumChecked && enumTypesPresent.some(k => activeNodeFilters.has(k)));
            }, "sub-filter");
        });
        syncGroupCheckboxState(enumCheckbox, enumTypesPresent);
    }
    
    otherTypesPresent.forEach(t => {
        createFilterCheckbox(nodesSection, \`filter-node-\${t}\`, formatLabel(t), "node", t, (checked, val) => {
            checked ? activeNodeFilters.add(val) : activeNodeFilters.delete(val);
        });
    });
    
    // --- Edges Section ---
    const edgesSection = legendDiv.append("div").attr("class", "filter-section").style("margin-top", "15px");
    edgesSection.append("strong").text("Edges");
    
    edgeTypes.forEach(type => {
        createFilterCheckbox(edgesSection, \`filter-edge-\${type}\`, formatLabel(type), "edge", type, (checked, val) => {
            checked ? activeFilters.add(val) : activeFilters.delete(val);
        });
    });
    
    // D3 Force Simulation
    let simulation = d3.forceSimulation()
        .force("link", d3.forceLink().id(d => d.id).distance(50))
        .force("charge", d3.forceManyBody().strength(-100))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide().radius(d => getRadius(d) + 5).iterations(2))
        .alphaDecay(0.02)
        .velocityDecay(0.3);
        
    // Map data for D3
    let nodesRaw = allNodes.map(d => Object.assign({}, d));
    let linksRaw = DATA.edges.map(d => Object.assign({}, d));
    
    // Compute node degrees
    const incomingCount = new Map();
    const outgoingCount = new Map();
    const neighborMap = new Map();
    
    linksRaw.forEach(l => {
        incomingCount.set(l.target, (incomingCount.get(l.target) || 0) + 1);
        outgoingCount.set(l.source, (outgoingCount.get(l.source) || 0) + 1);
        
        if (!neighborMap.has(l.source)) neighborMap.set(l.source, new Set());
        if (!neighborMap.has(l.target)) neighborMap.set(l.target, new Set());
        neighborMap.get(l.source).add(l.target);
        neighborMap.get(l.target).add(l.source);
    });
    
    function getRadius(d) {
        const degree = (incomingCount.get(d.id) || 0) + (outgoingCount.get(d.id) || 0);
        return Math.max(5, Math.min(25, 4 + Math.log2(degree + 1) * 3));
    }
    
    let link = container.append("g").selectAll(".link");
    let nodeGroup = container.append("g").selectAll(".node-group");
    let node = null;
    let nodeLabels = null;
    
    let searchHighlightNodeIds = new Set();
    let focusNodeId = null;
    let pinnedTooltipNodeId = null;
    
    function updateGraph() {
        const validNodeIds = new Set(nodesRaw.filter(n => activeNodeFilters.has(n.kind)).map(n => n.id));
        const filteredLinks = linksRaw.filter(l => {
            const sid = typeof l.source === 'object' ? l.source.id : l.source;
            const tid = typeof l.target === 'object' ? l.target.id : l.target;
            return activeFilters.has(l.type) && validNodeIds.has(sid) && validNodeIds.has(tid);
        });
        
        // Find visible nodes
        const activeNodeIds = new Set(validNodeIds);
        filteredLinks.forEach(l => {
            activeNodeIds.add(typeof l.source === 'object' ? l.source.id : l.source);
            activeNodeIds.add(typeof l.target === 'object' ? l.target.id : l.target);
        });
        
        // Keep nodes that match search even if isolated (and their kind is checked)
        nodesRaw.forEach(n => {
            if (searchHighlightNodeIds.has(n.id) && activeNodeFilters.has(n.kind)) {
                activeNodeIds.add(n.id);
            }
        });
        
        const filteredNodes = nodesRaw.filter(n => activeNodeIds.has(n.id) && activeNodeFilters.has(n.kind));
        const graphLinks = filteredLinks;
        
        // Update links
        link = link.data(graphLinks, d => {
            const sid = typeof d.source === 'object' ? d.source.id : d.source;
            const tid = typeof d.target === 'object' ? d.target.id : d.target;
            return sid + "-" + tid + "-" + d.type;
        });
        link.exit().remove();
        
        const linkEnter = link.enter().append("path")
            .attr("class", d => \`link link-\${d.type}\`)
            .attr("marker-end", d => {
                if (d.type === 'calls') return "url(#arrow-calls)";
                if (d.type === 'inherits') return "url(#arrow-inherits)";
                if (d.type === 'depends_on') return "url(#arrow-depends_on)";
                return "";
            });
            
        link = linkEnter.merge(link);
        
        // Update nodes
        nodeGroup = nodeGroup.data(filteredNodes, d => d.id);
        nodeGroup.exit().remove();
        
        const nodeEnter = nodeGroup.enter().append("g").attr("class", "node-group")
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));
                
        // Add circles
        nodeEnter.append("circle")
            .attr("class", d => \`node node-\${d.kind} \${d.graphId === 'toolset' ? 'toolset' : ''}\`)
            .attr("r", getRadius)
            .classed("node", true)
            .classed("toolset", d => d.graphId === 'toolset')
            .on("mouseover", showTooltip)
            .on("mouseout", hideTooltipWithDelay)
            .on("click", handleNodeClick)
            .on("dblclick", handleNodeDblClick);
            
        // Add labels
        nodeEnter.append("text")
            .attr("dx", 12)
            .attr("dy", ".35em")
            .text(d => d.displayName)
            .style("display", "none"); // Hidden by default based on zoom
            
        nodeGroup = nodeEnter.merge(nodeGroup);
        
        node = nodeGroup.select("circle");
        nodeLabels = nodeGroup.select("text");
        
        // Re-assign classes based on kind
        node.attr("class", d => {
            let k = "default";
            if (
                [
                    "project",
                    "anim_curve",
                    "data_file",
                    "script",
                    "script_resource",
                    "object",
                    "enum",
                    "enum_member",
                    "extension",
                    "font",
                    "function",
                    "macro",
                    "note",
                    "sprite",
                    "shader",
                    "room",
                    "sequence",
                    "sound",
                    "struct",
                    "struct_variable",
                    "constructor",
                    "instance_variable",
                    "local_variable",
                    "global_variable",
                    "object_event",
                    "particle_system",
                    "path",
                    "resource",
                    "tileset",
                    "timeline"
                ].includes(d.kind)
            ) {
                k = d.kind;
            }
            return \`node node-\${k} \${d.graphId === 'toolset' ? 'toolset' : ''}\`;
        });
        
        // Restart simulation
        simulation.nodes(filteredNodes).on("tick", ticked);
        simulation.force("link").links(graphLinks);
        simulation.alpha(0.3).restart();
        
        applyHighlights();
    }
    
    function ticked() {
        link.attr("d", d => {
            const dx = d.target.x - d.source.x;
            const dy = d.target.y - d.source.y;
            // Provide faint curve for non-calls
            if(d.type === 'references' || d.type === 'contains') {
                 const dr = Math.sqrt(dx * dx + dy * dy);
                 return \`M\${d.source.x},\${d.source.y}A\${dr},\${dr} 0 0,1 \${d.target.x},\${d.target.y}\`;
            }
            return \`M\${d.source.x},\${d.source.y}L\${d.target.x},\${d.target.y}\`;
        });

        nodeGroup.attr("transform", d => \`translate(\${d.x},\${d.y})\`);
    }
    
    // Interactions
    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }
    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }
    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        // keep pinned if fx/fy exist
    }
    
    function renderTooltip(event, d) {
        const inC = incomingCount.get(d.id) || 0;
        const outC = outgoingCount.get(d.id) || 0;
        
        let sub = d.summary || "";
        if (sub.length > 200) sub = sub.substring(0, 197) + "...";
        
        tooltip.html(\`
            <h3>\${d.displayName}</h3>
            <div><strong>Kind:</strong> \${d.kind} | <strong>Graph:</strong> \${d.graphId}</div>
            <div><strong>Connections:</strong> \${inC} in, \${outC} out</div>
            <p>\${sub}</p>
        \`)
        .style("left", (event.pageX + 15) + "px")
        .style("top", (event.pageY + 15) + "px")
        .classed("visible", true);
    }

    function showTooltip(event, d) {
        if (pinnedTooltipNodeId !== null && pinnedTooltipNodeId !== d.id) {
            return;
        }

        renderTooltip(event, d);
    }
    
    function hideTooltip() {
        pinnedTooltipNodeId = null;
        tooltip.classed("visible", false);
    }

    function hideTooltipWithDelay() {
        setTimeout(() => {
            if (pinnedTooltipNodeId === null && !tooltip.node().matches(":hover")) {
                hideTooltip();
            }
        }, 120);
    }
    
    function handleNodeClick(event, d) {
        event.stopPropagation();
        focusNodeId = d.id;
        pinnedTooltipNodeId = d.id;
        renderTooltip(event, d);
        applyHighlights();
    }
    
    function handleNodeDblClick(event, d) {
        // Toggle pin
        event.stopPropagation();
        if (d.fx == null) {
            d.fx = d.x;
            d.fy = d.y;
            d3.select(this).style("stroke", "#000").style("stroke-width", "3px");
        } else {
            d.fx = null;
            d.fy = null;
            d3.select(this).style("stroke", null).style("stroke-width", null);
        }
    }
    
    svg.on("click", clearFocus);
    
    function clearFocus() {
        focusNodeId = null;
        hideTooltip();
        searchHighlightNodeIds.clear();
        document.getElementById('search').value = '';
        applyHighlights();
    }
    
    // Search
    d3.select("#search").on("input", function() {
        const term = this.value.toLowerCase().trim();
        searchHighlightNodeIds.clear();
        focusNodeId = null; // clear focus on search
        hideTooltip();
        
        if (term.length > 0) {
            nodesRaw.forEach(n => {
                if (n.name.toLowerCase().includes(term) || n.displayName.toLowerCase().includes(term)) {
                    searchHighlightNodeIds.add(n.id);
                }
            });
        }
        
        applyHighlights();
    });
    
    function applyHighlights() {
        const isSearchActive = searchHighlightNodeIds.size > 0;
        const isFocusActive = focusNodeId !== null;
        const active = isSearchActive || isFocusActive;
        
        if (!active) {
            nodeGroup.classed("dimmed", false);
            node.classed("highlighted", false);
            link.classed("dimmed", false);
            return;
        }
        
        let highlightIds = new Set();
        
        if (isSearchActive) {
            searchHighlightNodeIds.forEach(id => highlightIds.add(id));
        }
        
        if (isFocusActive) {
            highlightIds.add(focusNodeId);
            if (neighborMap.has(focusNodeId)) {
                neighborMap.get(focusNodeId).forEach(n => highlightIds.add(n));
            }
        }
        
        nodeGroup.classed("dimmed", d => !highlightIds.has(d.id));
        node.classed("highlighted", d => {
            if (isFocusActive && d.id === focusNodeId) return true;
            if (isSearchActive && searchHighlightNodeIds.has(d.id)) return true;
            return false;
        });
        
        link.classed("dimmed", d => {
            const sid = typeof d.source === 'object' ? d.source.id : d.source;
            const tid = typeof d.target === 'object' ? d.target.id : d.target;
            
            if (isFocusActive) {
                return !(sid === focusNodeId || tid === focusNodeId);
            }
            return !(highlightIds.has(sid) && highlightIds.has(tid));
        });
    }

    tooltip.on("mouseenter", () => tooltip.classed("visible", true));
    tooltip.on("mouseleave", () => {
        if (pinnedTooltipNodeId === null) {
            hideTooltip();
        }
    });

    // Initial render
    updateGraph();
  </script>
</body>
</html>`;
}
