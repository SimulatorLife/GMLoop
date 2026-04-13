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
    .link-calls { stroke: #1f77b4; stroke-width: 1.5px; }
    .link-references { stroke: #999; stroke-width: 1px; stroke-dasharray: 4,4; }
    .link-contains { stroke: #2ca02c; stroke-width: 1px; stroke-dasharray: 2,2; }
    .link-defines { stroke: #2ca02c; stroke-width: 1px; stroke-dasharray: 2,2; }
    .link-inherits { stroke: #d62728; stroke-width: 2px; }
    .link-uses_toolset { stroke: #ff7f0e; stroke-width: 1px; stroke-dasharray: 4,4; }
    .link-depends_on { stroke: #7f7f7f; stroke-width: 1.5px; }
    .link-placed_in_room { stroke: #9467bd; stroke-width: 1px; stroke-dasharray: 2,2; }
    
    /* Node colors */
    .node-script { fill: #1f77b4; }
    .node-object { fill: #2ca02c; }
    .node-enum { fill: #9467bd; }
    .node-macro { fill: #ff7f0e; }
    .node-file { fill: #c7c7c7; }
    .node-resource, .node-sprite, .node-shader, .node-room { fill: #8c564b; }
    .node-default { fill: #7f7f7f; }
    
    text { font-size: 10px; pointer-events: none; fill: #e0e0e0; text-shadow: 0 1px 2px #1e1e1e, 0 -1px 2px #1e1e1e, 1px 0 2px #1e1e1e, -1px 0 2px #1e1e1e; }
    
    #tooltip { position: absolute; background: #252526; padding: 10px; border: 1px solid #444; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.5); pointer-events: none; font-size: 12px; z-index: 20; max-width: 300px; display: none; color: #eee; }
    #tooltip.visible { display: block; }
    #tooltip h3 { margin: 0 0 5px 0; font-size: 14px; word-break: break-all; color: #fff; }
    
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
    <button id="reset-default">Reset</button>
  </header>
  <main>
    <svg id="graph">
      <defs>
        <!-- Arrow markers -->
        <marker id="arrow-calls" viewBox="0 -5 10 10" refX="18" refY="0" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,-5L10,0L0,5" fill="#1f77b4"></path></marker>
        <marker id="arrow-inherits" viewBox="0 -5 10 10" refX="20" refY="0" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,-5L10,0L0,5" fill="#d62728"></path></marker>
        <marker id="arrow-depends_on" viewBox="0 -5 10 10" refX="18" refY="0" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,-5L10,0L0,5" fill="#7f7f7f"></path></marker>
      </defs>
      <g id="container"></g>
    </svg>
    <div id="tooltip"></div>
    <aside id="legend">
        <!-- Rendered by JS -->
    </aside>
  </main>
  <script>
    const DATA = ${dataJson};
    
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    const svg = d3.select("#graph");
    const container = d3.select("#container");
    const tooltip = d3.select("#tooltip");
    
    // Setup Zoom
    const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on("zoom", (e) => {
            container.attr("transform", e.transform);
            
            // Progressive label rendering
            if (e.transform.k > 0.8) {
                nodeLabels.style("display", "block");
            } else {
                nodeLabels.style("display", "none");
            }
        });
        
    svg.call(zoom);
    
    d3.select("#reset-default").on("click", () => {
       svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
       if (typeof clearFocus === 'function') clearFocus();
       
       // Reset filters
       activeFilters = new Set(edgeTypes);
       activeNodeFilters = new Set(DATA.nodes.map(n => n.kind));
       d3.selectAll("#legend input[type='checkbox']").property("checked", true).property("indeterminate", false);
       
       updateGraph();
    });
    
    // Performance guardrails
    if (DATA.nodes.length > 2000) {
        console.warn("Large graph detected:", DATA.nodes.length, "nodes. Adjusting rendering parameters.");
    }
    
    // Extract filters
    const edgeTypes = Array.from(new Set(DATA.edges.map(e => e.type)));
    let activeFilters = new Set(edgeTypes);
    
    const resourceKinds = new Set(["script", "object", "room", "sprite", "shader"]);
    const resourceTypesPresent = Array.from(new Set(DATA.nodes.map(n => n.kind).filter(k => resourceKinds.has(k))));
    const otherTypesPresent = Array.from(new Set(DATA.nodes.map(n => n.kind).filter(k => !resourceKinds.has(k))));
    let activeNodeFilters = new Set(DATA.nodes.map(n => n.kind));

    function createFilterCheckbox(container, id, labelText, category, typeVal, changeHandler, customClass="") {
        const wrap = container.append("label").attr("class", \`filter-item \${customClass}\`);
        const checkbox = wrap.append("input")
            .attr("type", "checkbox")
            .attr("id", id)
            .attr("checked", true)
            .on("change", function() {
                changeHandler(this.checked, typeVal);
                updateGraph();
            });
        
        if (category === 'node' || category === 'node-group') {
             let color = "#7f7f7f"; // default
             if (typeVal === 'script') color = "#1f77b4";
             else if (typeVal === 'object') color = "#2ca02c";
             else if (typeVal === 'enum') color = "#9467bd";
             else if (typeVal === 'macro') color = "#ff7f0e";
             else if (typeVal === 'file') color = "#c7c7c7";             else if (typeVal === 'struct') color = "#e377c2";
             else if (typeVal === 'constructor') color = "#e377c2";
             else if (typeVal.includes('variable')) color = "#17becf";             else if (resourceKinds.has(typeVal) || typeVal === 'resource') color = "#8c564b";
             wrap.append("span").html(\`<span style="color:\${color}">■</span> \${labelText}\`);
        } else {
             let strokeStyle = "border-bottom: 2px solid #555;";
             if (typeVal === 'calls') strokeStyle = "border-bottom: 2px solid #1f77b4;";
             else if (typeVal === 'references') strokeStyle = "border-bottom: 1px dashed #999;";
             else if (typeVal === 'contains') strokeStyle = "border-bottom: 1px dashed #2ca02c;";
             else if (typeVal === 'defines') strokeStyle = "border-bottom: 1px dashed #2ca02c;";
             else if (typeVal === 'inherits') strokeStyle = "border-bottom: 2px solid #d62728;";
             else if (typeVal === 'uses_toolset') strokeStyle = "border-bottom: 1px dashed #ff7f0e;";
             else if (typeVal === 'depends_on') strokeStyle = "border-bottom: 2px solid #7f7f7f;";
             else if (typeVal === 'placed_in_room') strokeStyle = "border-bottom: 1px dashed #9467bd;";
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
    let nodesRaw = DATA.nodes.map(d => Object.assign({}, d));
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
    
    function updateGraph() {
        const validNodeIds = new Set(nodesRaw.filter(n => activeNodeFilters.has(n.kind)).map(n => n.id));
        const filteredLinks = linksRaw.filter(l => {
            const sid = typeof l.source === 'object' ? l.source.id : l.source;
            const tid = typeof l.target === 'object' ? l.target.id : l.target;
            return activeFilters.has(l.type) && validNodeIds.has(sid) && validNodeIds.has(tid);
        });
        
        // Find visible nodes
        const activeNodeIds = new Set();
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
        
        // Update links
        link = link.data(filteredLinks, d => {
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
            .on("mouseout", hideTooltip)
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
            if (["script", "object", "enum", "macro", "file", "resource", "sprite", "shader", "room"].includes(d.kind)) {
                k = d.kind;
            }
            return \`node node-\${k} \${d.graphId === 'toolset' ? 'toolset' : ''}\`;
        });
        
        // Restart simulation
        simulation.nodes(filteredNodes).on("tick", ticked);
        simulation.force("link").links(filteredLinks);
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
    
    function showTooltip(event, d) {
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
    
    function hideTooltip() {
        tooltip.classed("visible", false);
    }
    
    function handleNodeClick(event, d) {
        event.stopPropagation();
        focusNodeId = focusNodeId === d.id ? null : d.id;
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
        searchHighlightNodeIds.clear();
        document.getElementById('search').value = '';
        applyHighlights();
    }
    
    // Search
    d3.select("#search").on("input", function() {
        const term = this.value.toLowerCase().trim();
        searchHighlightNodeIds.clear();
        focusNodeId = null; // clear focus on search
        
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

    // Initial render
    updateGraph();
  </script>
</body>
</html>`;
}
