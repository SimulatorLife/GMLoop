import { EDGE_LINE_VISUAL_STYLES, NODE_VISUAL_STYLES } from "./graph-visualization-style-metadata.js";

export function renderGraphVisualizationClientScript(serializedData: string, isServerMode: boolean): string {
    return `
    const DATA = ${serializedData};
    const DOCUMENTATION_CATALOGS = window.__GMLOOP_DOCUMENTATION_CATALOGS__ ?? null;
    const IS_SERVER_MODE = ${isServerMode ? "true" : "false"};
    const LOADED_TARGET = window.__GMLOOP_LOADED_TARGET__ ?? null;
    const PROJECT_CONFIGURATION = window.__GMLOOP_PROJECT_CONFIGURATION__ ?? null;
    let currentLoadedTarget = LOADED_TARGET;
    let currentProjectConfiguration = PROJECT_CONFIGURATION;
    let selectedProjectConfiguration = null;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const svg = d3.select("#graph");
    const jsonView = d3.select("#json-view");
    const container = d3.select("#container");
    const tooltip = d3.select("#tooltip");
    let labelMode = "auto";
    let activeGraphView = "visual";
    let activePage = "graph";
    const edgeLineVisualStyles = ${JSON.stringify(EDGE_LINE_VISUAL_STYLES)};
    const edgeLineVisualStyleByType = new Map(edgeLineVisualStyles.map((style) => [style.type, style]));
    const nodeVisualStyles = ${JSON.stringify(NODE_VISUAL_STYLES)};
    const nodeVisualStyleByKind = new Map(nodeVisualStyles.map((style) => [style.kind, style]));
    
    const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on("zoom", (e) => {
            container.attr("transform", e.transform);
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

    let activeDocsView = "cli";

    function updateGraphViewMode() {
        const isVisualView = activeGraphView === "visual";
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
    }

    d3.select("#toggle-view").on("click", () => {
        activeGraphView = activeGraphView === "visual" ? "json" : "visual";
        updateGraphViewMode();
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

    function renderLoadedTargetSummary() {
        const loadedTargetEl = document.getElementById("loaded-target");
        const loadedSourceEl = document.getElementById("loaded-source");
        const loadedSelectedEl = document.getElementById("loaded-selected");
        if (!(loadedTargetEl instanceof HTMLElement) || !(loadedSourceEl instanceof HTMLElement) || !(loadedSelectedEl instanceof HTMLElement)) {
            return;
        }

        if (!currentLoadedTarget || typeof currentLoadedTarget !== "object") {
            loadedTargetEl.textContent = "No active target";
            loadedSourceEl.textContent = "";
            loadedSelectedEl.textContent = "";
            return;
        }

        loadedTargetEl.textContent = "Active: " + currentLoadedTarget.activePath;
        loadedSourceEl.textContent = "Source: " + currentLoadedTarget.source + " | Project: " + currentLoadedTarget.projectRoot;
        if (Array.isArray(currentLoadedTarget.selectedPaths) && currentLoadedTarget.selectedPaths.length > 1) {
            loadedSelectedEl.textContent = "Selected paths: " + currentLoadedTarget.selectedPaths.join(", ");
        } else {
            loadedSelectedEl.textContent = "";
        }
    }

    renderLoadedTargetSummary();

    function createCatalogItemRow(labelText, valueText) {
        const row = document.createElement("li");
        row.className = "catalog-item";
        row.innerHTML = "<code>" + labelText + "</code> " + valueText;
        return row;
    }

    async function loadProjectConfigurationFromFiles(files) {
        const normalizePath = (file) =>
            typeof file.webkitRelativePath === "string" && file.webkitRelativePath.length > 0
                ? file.webkitRelativePath
                : file.name;

        const projectFiles = files.map((file) => ({
            file,
            path: normalizePath(file),
            basename: normalizePath(file).replace(/^.*[\\/]/u, "")
        }));

        const gmloopEntry = projectFiles.find((entry) => entry.basename.toLowerCase() === "gmloop.json");
        let gmloopRawConfig = {};
        let gmloopConfigPath = null;
        if (gmloopEntry) {
            try {
                gmloopRawConfig = JSON.parse(await gmloopEntry.file.text());
                gmloopConfigPath = gmloopEntry.path;
            } catch {
                gmloopRawConfig = {};
                gmloopConfigPath = gmloopEntry.path;
            }
        }

        const prettierConfigNames = [
            ".prettierrc",
            ".prettierrc.json",
            ".prettierrc.yaml",
            ".prettierrc.yml",
            ".prettierrc.js",
            "prettier.config.js",
            "prettier.config.cjs",
            "prettier.config.mjs"
        ];
        const eslintConfigNames = [
            ".eslintrc",
            ".eslintrc.json",
            ".eslintrc.yaml",
            ".eslintrc.yml",
            ".eslintrc.js",
            ".eslintrc.cjs",
            ".eslintrc.mjs",
            "eslint.config.js",
            "eslint.config.cjs",
            "eslint.config.mjs"
        ];

        const prettierFiles = projectFiles.filter((entry) => prettierConfigNames.includes(entry.basename.toLowerCase()));
        const eslintFiles = projectFiles.filter((entry) => eslintConfigNames.includes(entry.basename.toLowerCase()));

        const readFileContent = async (entry) => {
            try {
                return await entry.file.text();
            } catch {
                return "";
            }
        };

        return {
            gmloop: {
                configPath: gmloopConfigPath,
                rawConfig: gmloopRawConfig
            },
            prettier: await Promise.all(
                prettierFiles.map(async (entry) => ({ path: entry.path, content: await readFileContent(entry) }))
            ),
            eslint: await Promise.all(
                eslintFiles.map(async (entry) => ({ path: entry.path, content: await readFileContent(entry) }))
            )
        };
    }

    function createCatalogCard(title, descriptionText, usageText, rows) {
        const card = document.createElement("section");
        card.className = "catalog-card";

        const heading = document.createElement("h3");
        heading.textContent = title;
        card.append(heading);

        if (usageText) {
            const usage = document.createElement("code");
            usage.className = "catalog-usage";
            usage.textContent = usageText;
            card.append(usage);
        }

        if (descriptionText) {
            const description = document.createElement("p");
            description.textContent = descriptionText;
            card.append(description);
        }

        if (rows.length > 0) {
            const list = document.createElement("ul");
            list.className = "catalog-list";
            rows.forEach((row) => list.append(row));
            card.append(list);
        }

        return card;
    }

    let cliMetaText = "";
    let mcpMetaText = "";

    function renderDocumentationCatalog() {
        const docsMetaElement = document.getElementById("docs-meta");
        const cliContentElement = document.getElementById("cli-content");
        const mcpContentElement = document.getElementById("mcp-content");
        if (!(docsMetaElement instanceof HTMLElement) || !(cliContentElement instanceof HTMLElement) || !(mcpContentElement instanceof HTMLElement)) {
            return;
        }

        cliContentElement.innerHTML = "";
        mcpContentElement.innerHTML = "";

        if (!DOCUMENTATION_CATALOGS || typeof DOCUMENTATION_CATALOGS !== "object") {
            cliMetaText = "No CLI catalog metadata is available for this view.";
            mcpMetaText = "No MCP catalog metadata is available for this view.";
            const emptyState = document.createElement("div");
            emptyState.className = "catalog-empty";
            emptyState.textContent = "Documentation catalogs are not available.";
            cliContentElement.append(emptyState.cloneNode(true));
            mcpContentElement.append(emptyState);
            updateDocsViewState();
            return;
        }

        const cliCommands = Array.isArray(DOCUMENTATION_CATALOGS.cliCommands) ? DOCUMENTATION_CATALOGS.cliCommands : [];
        cliMetaText = cliCommands.length + " CLI command entries sourced directly from the Commander command catalog.";
        cliCommands.forEach((entry) => {
            const rows = [];
            if (Array.isArray(entry.arguments)) {
                entry.arguments.forEach((argument) => {
                    const detailParts = [];
                    detailParts.push(argument.required ? "required" : "optional");
                    if (argument.variadic) {
                        detailParts.push("variadic");
                    }
                    if (Array.isArray(argument.choices) && argument.choices.length > 0) {
                        detailParts.push("choices: " + argument.choices.join(", "));
                    }
                    const suffix = detailParts.length > 0 ? " (" + detailParts.join(", ") + ")" : "";
                    rows.push(createCatalogItemRow("<" + argument.name + ">", (argument.description || "No description.") + suffix));
                });
            }
            if (Array.isArray(entry.options)) {
                entry.options.forEach((option) => {
                    const optionName = option.long || option.flags;
                    const detailParts = [];
                    if (option.boolean) {
                        detailParts.push("boolean");
                    }
                    if (option.variadic) {
                        detailParts.push("variadic");
                    }
                    if (Array.isArray(option.choices) && option.choices.length > 0) {
                        detailParts.push("choices: " + option.choices.join(", "));
                    }
                    const suffix = detailParts.length > 0 ? " (" + detailParts.join(", ") + ")" : "";
                    rows.push(createCatalogItemRow(optionName, (option.description || "No description.") + suffix));
                });
            }
            cliContentElement.append(createCatalogCard(entry.displayName, entry.description, entry.usage, rows));
        });

        const mcpTools = Array.isArray(DOCUMENTATION_CATALOGS.mcpTools) ? DOCUMENTATION_CATALOGS.mcpTools : [];
        const mcpServer = DOCUMENTATION_CATALOGS.mcpServer || null;
        mcpMetaText = (mcpServer ? (mcpServer.name + " v" + mcpServer.version + " | ") : "") + mcpTools.length + " MCP tools derived from the CLI catalog.";
        mcpTools.forEach((entry) => {
            const rows = [];
            if (Array.isArray(entry.fields)) {
                entry.fields.forEach((field) => {
                    const detailParts = [];
                    detailParts.push(field.kind);
                    detailParts.push(field.required ? "required" : "optional");
                    if (field.multiple) {
                        detailParts.push("multiple");
                    }
                    if (Array.isArray(field.choices) && field.choices.length > 0) {
                        detailParts.push("choices: " + field.choices.join(", "));
                    }
                    rows.push(createCatalogItemRow(field.name, (field.description || "No description.") + " (" + detailParts.join(", ") + ")"));
                });
            }
            mcpContentElement.append(createCatalogCard(entry.toolName, entry.description, entry.commandDisplayName, rows));
        });

        updateDocsViewState();
    }

    function updateDocsViewState() {
        const cliPage = document.getElementById("cli-page");
        const mcpPage = document.getElementById("mcp-page");
        const cliButton = document.getElementById("docs-view-cli");
        const mcpButton = document.getElementById("docs-view-mcp");
        const docsMetaElement = document.getElementById("docs-meta");

        if (!(cliPage instanceof HTMLElement) || !(mcpPage instanceof HTMLElement) || !(cliButton instanceof HTMLButtonElement) || !(mcpButton instanceof HTMLButtonElement) || !(docsMetaElement instanceof HTMLElement)) {
            return;
        }

        cliPage.classList.toggle("hidden", activeDocsView !== "cli");
        mcpPage.classList.toggle("hidden", activeDocsView !== "mcp");
        cliButton.classList.toggle("active", activeDocsView === "cli");
        mcpButton.classList.toggle("active", activeDocsView === "mcp");
        docsMetaElement.textContent = activeDocsView === "cli" ? cliMetaText : mcpMetaText;
    }

    function createBadge(labelText) {
        const badge = document.createElement("span");
        badge.className = "config-badge";
        badge.textContent = labelText;
        return badge;
    }

    function createConfigItem(title, descriptionText, valueText, badges) {
        const item = document.createElement("li");
        item.className = "config-item";

        const heading = document.createElement("strong");
        heading.textContent = title;
        item.append(heading);

        if (descriptionText) {
            const description = document.createElement("span");
            description.textContent = descriptionText;
            item.append(description);
        }

        if (Array.isArray(badges) && badges.length > 0) {
            const badgeRow = document.createElement("div");
            badgeRow.className = "config-badge-row";
            badges.forEach((badgeText) => badgeRow.append(createBadge(badgeText)));
            item.append(badgeRow);
        }

        if (valueText) {
            const value = document.createElement("div");
            value.className = "config-value";
            value.textContent = valueText;
            item.append(value);
        }

        return item;
    }

    function createConfigCard(title, descriptionText, children) {
        const card = document.createElement("section");
        card.className = "config-card";

        const heading = document.createElement("h3");
        heading.textContent = title;
        card.append(heading);

        if (descriptionText) {
            const description = document.createElement("p");
            description.textContent = descriptionText;
            card.append(description);
        }

        children.forEach((child) => card.append(child));
        return card;
    }

    function renderProjectConfigurationCatalog() {
        const configMetaElement = document.getElementById("config-meta");
        const configContentElement = document.getElementById("config-content");
        if (!(configMetaElement instanceof HTMLElement) || !(configContentElement instanceof HTMLElement)) {
            return;
        }

        configContentElement.innerHTML = "";

        if (!PROJECT_CONFIGURATION && !selectedProjectConfiguration) {
            configMetaElement.textContent = "No project configuration is available for this view.";
            const emptyState = document.createElement("div");
            emptyState.className = "catalog-empty";
            emptyState.textContent = "Load a project to inspect gmloop, lint, format, and refactor configuration.";
            configContentElement.append(emptyState);
            return;
        }

        const effectiveConfiguration = selectedProjectConfiguration
            ? { ...(PROJECT_CONFIGURATION || {}), gmloop: selectedProjectConfiguration.gmloop }
            : PROJECT_CONFIGURATION;

        const gmloopConfig = (effectiveConfiguration && effectiveConfiguration.gmloop) || { configPath: null, exists: false, projectRoot: "", rawConfig: {} };
        configMetaElement.textContent = selectedProjectConfiguration
            ? "Loaded project configuration from the selected project."
            : gmloopConfig.exists
            ? "Loaded project configuration and workspace-owned normalized views for the active project."
            : "No gmloop.json was found for the active selection. Defaults and registered workspace metadata are shown where available.";

        const overviewGrid = document.createElement("div");
        overviewGrid.className = "config-grid";

        const gmloopRaw = document.createElement("pre");
        gmloopRaw.className = "config-raw";
        gmloopRaw.textContent = JSON.stringify(gmloopConfig.rawConfig || {}, null, 2);
        overviewGrid.append(
            createConfigCard("gmloop.json", gmloopConfig.configPath || "No gmloop.json file is currently loaded.", [gmloopRaw])
        );

        const repositoryLink = document.createElement("a");
        repositoryLink.className = "github-link";
        repositoryLink.href = (effectiveConfiguration || {}).githubRepositoryUrl || "https://github.com/SimulatorLife/GMLoop";
        repositoryLink.target = "_blank";
        repositoryLink.rel = "noreferrer";
        repositoryLink.textContent = "Open Public Repository";
        overviewGrid.append(
            createConfigCard("Repository", "Project root and canonical public repository for GMLoop.", [
                createConfigItem(
                    "Project Root",
                    "Active project root used by graph, lint, format, and refactor workflows.",
                    gmloopConfig.projectRoot || "(none)",
                    []
                ),
                repositoryLink
            ])
        );
        configContentElement.append(overviewGrid);

        if (selectedProjectConfiguration) {
            const selectedConfigContainer = document.createElement("div");
            selectedConfigContainer.className = "config-grid";

            if (Array.isArray(selectedProjectConfiguration.prettier) && selectedProjectConfiguration.prettier.length > 0) {
                const prettierCards = selectedProjectConfiguration.prettier.map((entry) => {
                    const contentPre = document.createElement("pre");
                    contentPre.className = "config-raw";
                    contentPre.textContent = entry.content || "";
                    return createConfigCard("Prettier config: " + entry.path, "Selected project Prettier configuration file.", [contentPre]);
                });
                prettierCards.forEach((card) => selectedConfigContainer.append(card));
            }

            if (Array.isArray(selectedProjectConfiguration.eslint) && selectedProjectConfiguration.eslint.length > 0) {
                const eslintCards = selectedProjectConfiguration.eslint.map((entry) => {
                    const contentPre = document.createElement("pre");
                    contentPre.className = "config-raw";
                    contentPre.textContent = entry.content || "";
                    return createConfigCard("ESLint config: " + entry.path, "Selected project ESLint configuration file.", [contentPre]);
                });
                eslintCards.forEach((card) => selectedConfigContainer.append(card));
            }

            if (selectedConfigContainer.children.length > 0) {
                configContentElement.append(selectedConfigContainer);
            }
        }

        const formatEntries = Array.isArray(effectiveConfiguration?.format?.entries)
            ? effectiveConfiguration.format.entries
            : [];
        const formatList = document.createElement("ul");
        formatList.className = "config-list";
        formatEntries.forEach((entry) => {
            formatList.append(
                createConfigItem(
                    entry.name,
                    entry.description,
                    JSON.stringify(entry.value, null, 2),
                    [entry.source]
                )
            );
        });
        configContentElement.append(
            createConfigCard("Format / Prettier", "Formatter-owned options sourced from the format workspace.", [formatList])
        );

        const lintRules = Array.isArray(effectiveConfiguration?.lint?.rules) ? effectiveConfiguration.lint.rules : [];
        const lintList = document.createElement("ul");
        lintList.className = "config-list";
        lintRules.forEach((entry) => {
            const badges = [entry.level];
            if (entry.fixable) {
                badges.push("fixable:" + entry.fixable);
            }
            lintList.append(
                createConfigItem(entry.ruleId, entry.description, JSON.stringify(entry.options, null, 2), badges)
            );
        });
        configContentElement.append(
            createConfigCard(
                "Lint",
                effectiveConfiguration?.lint?.ruleset
                    ? "Resolved lint rules for the active gmloop lintRuleset: " + effectiveConfiguration.lint.ruleset
                    : "Resolved lint rules for the active project configuration.",
                [lintList]
            )
        );

        const refactorCodemods = Array.isArray(effectiveConfiguration?.refactor?.codemods)
            ? effectiveConfiguration.refactor.codemods
            : [];
        const refactorList = document.createElement("ul");
        refactorList.className = "config-list";
        refactorCodemods.forEach((entry) => {
            const badges = [entry.enabled ? "enabled" : "disabled"];
            if (entry.requiresSemanticProjectIndex) {
                badges.push("semantic-index");
            }
            refactorList.append(
                createConfigItem(entry.id, entry.description, JSON.stringify(entry.config, null, 2), badges)
            );
        });
        configContentElement.append(
            createConfigCard("Refactor", "Registered codemods and the active project-level codemod configuration.", [
                refactorList
            ])
        );
    }

    function updatePageState() {
        const pages = [
            { buttonId: "tab-graph", pageId: "graph-page", pageValue: "graph" },
            { buttonId: "tab-docs", pageId: "docs-page", pageValue: "docs" },
            { buttonId: "tab-config", pageId: "config-page", pageValue: "config" }
        ];
        pages.forEach((entry) => {
            const button = document.getElementById(entry.buttonId);
            const page = document.getElementById(entry.pageId);
            if (button instanceof HTMLButtonElement) {
                button.classList.toggle("active", activePage === entry.pageValue);
            }
            if (page instanceof HTMLElement) {
                page.classList.toggle("active", activePage === entry.pageValue);
            }
        });

        const toolbarHeading = document.getElementById("toolbar-heading");
        const toolbarSubheading = document.getElementById("toolbar-subheading");
        const graphControls = document.getElementById("graph-controls");
        if (toolbarHeading instanceof HTMLElement && toolbarSubheading instanceof HTMLElement && graphControls instanceof HTMLElement) {
            graphControls.classList.toggle("hidden", activePage !== "graph");
            if (activePage === "graph") {
                toolbarHeading.textContent = "Graph Index";
                toolbarSubheading.textContent = "Interactive graph exploration controls for the current graph index.";
            } else if (activePage === "cli") {
                toolbarHeading.textContent = "CLI";
                toolbarSubheading.textContent = "Live command catalog sourced directly from the CLI workspace.";
            } else if (activePage === "docs") {
                toolbarHeading.textContent = "Docs";
                toolbarSubheading.textContent = "Live CLI and MCP workspace catalogs are combined in a single Docs view.";
            } else {
                toolbarHeading.textContent = "Config";
                toolbarSubheading.textContent = "Loaded project configuration rendered from lint, format, refactor, and gmloop workspace data.";
            }
        }

        if (activePage === "graph") {
            updateGraphViewMode();
        } else {
            svg.classed("hidden", true);
            d3.select("#legend").classed("hidden", true);
            d3.select("#tooltip").classed("hidden", true);
            jsonView.classed("hidden", true).style("display", "none");
        }
    }

    ["graph", "docs", "config"].forEach((pageValue) => {
        const button = document.getElementById("tab-" + pageValue);
        if (button instanceof HTMLButtonElement) {
            button.addEventListener("click", () => {
                activePage = pageValue;
                updatePageState();
            });
        }
    });

    const docsCliButton = document.getElementById("docs-view-cli");
    const docsMcpButton = document.getElementById("docs-view-mcp");
    if (docsCliButton instanceof HTMLButtonElement) {
        docsCliButton.addEventListener("click", () => {
            activeDocsView = "cli";
            updateDocsViewState();
        });
    }
    if (docsMcpButton instanceof HTMLButtonElement) {
        docsMcpButton.addEventListener("click", () => {
            activeDocsView = "mcp";
            updateDocsViewState();
        });
    }

    renderDocumentationCatalog();
    renderProjectConfigurationCatalog();
    updatePageState();
    
    if (DATA.nodes.length > 2000) {
        console.warn("Large graph detected:", DATA.nodes.length, "nodes. Adjusting rendering parameters.");
    }
    
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
        "room",
        "script",
        "sequence",
        "shader",
        "sound",
        "sprite",
        "tileset",
        "timeline"
    ]);
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
        (kindValue) =>
            kindValue !== "resource" &&
            !resourceKinds.has(kindValue) &&
            kindValue !== "enum" &&
            kindValue !== "enum_member"
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
            .property("checked", createInitialFilterCheckedState(category, typeVal))
            .on("change", function() {
                changeHandler(this.checked, typeVal);
                updateGraph();
            });
        
        if (category === 'node' || category === 'node-group') {
             const color = nodeVisualStyleByKind.get(typeVal)?.color ?? nodeVisualStyleByKind.get("default").color;
             let shapeHtml = \`<span style="color:\${color}">&#9679;</span>\`;
             if (typeVal.endsWith("_variable")) {
                 shapeHtml = \`<span style="color:\${color}">&#9830;</span>\`;
             } else if (resourceKinds.has(typeVal) || typeVal === "resource-group") {
                 shapeHtml = \`<span style="color:\${color}">&#9632;</span>\`;
             }
             wrap.append("span").html(\`\${shapeHtml} \${labelText}\`);
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
    const nodesSection = legendDiv.append("div").attr("class", "filter-section");
    nodesSection.append("strong").text("Nodes");
    
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
    
    const edgesSection = legendDiv.append("div").attr("class", "filter-section").style("margin-top", "15px");
    edgesSection.append("strong").text("Edges");
    
    edgeTypes.forEach(type => {
        createFilterCheckbox(edgesSection, \`filter-edge-\${type}\`, formatLabel(type), "edge", type, (checked, val) => {
            checked ? activeFilters.add(val) : activeFilters.delete(val);
        });
    });
    
    let simulation = d3.forceSimulation()
        .force("link", d3.forceLink().id(d => d.id).distance(50))
        .force("charge", d3.forceManyBody().strength(-100))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide().radius(d => getRadius(d) + 5).iterations(2))
        .alphaDecay(0.02)
        .velocityDecay(0.3);
        
    function cloneGraphNodes() {
        return allNodes.map((nodeValue) => Object.assign({}, nodeValue));
    }

    function cloneGraphEdges() {
        return DATA.edges.map((edgeValue) => Object.assign({}, edgeValue));
    }

    let nodesRaw = cloneGraphNodes();
    let linksRaw = cloneGraphEdges();
    
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

    function resetGraphStateToDefaults() {
        nodesRaw = cloneGraphNodes();
        linksRaw = cloneGraphEdges();
        activeFilters = new Set(edgeTypes);
        activeNodeFilters = new Set(defaultEnabledNodeKinds);
        searchHighlightNodeIds.clear();
        focusNodeId = null;
        pinnedTooltipNodeId = null;
        hideTooltip();

        const searchInput = document.getElementById("search");
        if (searchInput instanceof HTMLInputElement) {
            searchInput.value = "";
        }

        d3.selectAll("#legend input[type='checkbox']").property("indeterminate", false);
        allNodeKinds.forEach((kindValue) => {
            d3.select(\`#filter-node-\${kindValue}\`).property("checked", defaultEnabledNodeKinds.includes(kindValue));
        });
        edgeTypes.forEach((edgeTypeValue) => {
            d3.select(\`#filter-edge-\${edgeTypeValue}\`).property("checked", true);
        });
        syncGroupCheckboxState(resourceCheckbox, resourceTypesPresent);
        syncGroupCheckboxState(enumCheckbox, enumTypesPresent);
    }

    d3.select("#reset-default").on("click", () => {
       svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
       resetGraphStateToDefaults();
       updateGraph();
    });

    function updateGraph() {
        const validNodeIds = new Set(nodesRaw.filter(n => activeNodeFilters.has(n.kind)).map(n => n.id));
        const filteredLinks = linksRaw.filter(l => {
            const sid = typeof l.source === 'object' ? l.source.id : l.source;
            const tid = typeof l.target === 'object' ? l.target.id : l.target;
            return activeFilters.has(l.type) && validNodeIds.has(sid) && validNodeIds.has(tid);
        });
        
        const activeNodeIds = new Set(validNodeIds);
        filteredLinks.forEach(l => {
            activeNodeIds.add(typeof l.source === 'object' ? l.source.id : l.source);
            activeNodeIds.add(typeof l.target === 'object' ? l.target.id : l.target);
        });
        
        nodesRaw.forEach(n => {
            if (searchHighlightNodeIds.has(n.id) && activeNodeFilters.has(n.kind)) {
                activeNodeIds.add(n.id);
            }
        });
        
        const filteredNodes = nodesRaw.filter(n => activeNodeIds.has(n.id) && activeNodeFilters.has(n.kind));
        const graphLinks = filteredLinks;
        
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
        
        nodeGroup = nodeGroup.data(filteredNodes, d => d.id);
        nodeGroup.exit().remove();
        
        const nodeEnter = nodeGroup.enter().append("g").attr("class", "node-group")
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));
                
        nodeEnter.append("path")
            .attr("class", d => \`node node-\${d.kind} \${d.graphId === 'toolset' ? 'toolset' : ''}\`)
            .attr("d", d => {
                const area = Math.pow(getRadius(d), 2) * Math.PI;
                let symbolType = d3.symbolCircle;
                if (d.kind.endsWith("_variable")) {
                    symbolType = d3.symbolDiamond;
                } else if (resourceKinds.has(d.kind)) {
                    symbolType = d3.symbolSquare;
                }
                return d3.symbol().type(symbolType).size(area)();
            })
            .classed("node", true)
            .classed("toolset", d => d.graphId === 'toolset')
            .on("mouseover", showTooltip)
            .on("mouseout", hideTooltipWithDelay)
            .on("click", handleNodeClick)
            .on("dblclick", handleNodeDblClick);
            
        nodeEnter.append("text")
            .attr("dx", 12)
            .attr("dy", ".35em")
            .text(d => d.displayName)
            .style("display", "none");
            
        nodeGroup = nodeEnter.merge(nodeGroup);
        node = nodeGroup.select("path.node");
        nodeLabels = nodeGroup.select("text");
        
        node.attr("class", d => {
            let k = "default";
            if (nodeVisualStyleByKind.has(d.kind)) {
                k = d.kind;
            }
            return \`node node-\${k} \${d.graphId === 'toolset' ? 'toolset' : ''}\`;
        });
        
        simulation.nodes(filteredNodes).on("tick", ticked);
        simulation.force("link").links(graphLinks);
        simulation.alpha(0.3).restart();
        
        applyHighlights();
    }
    
    function ticked() {
        link.attr("d", d => {
            const dx = d.target.x - d.source.x;
            const dy = d.target.y - d.source.y;
            if(d.type === 'references' || d.type === 'contains') {
                 const dr = Math.sqrt(dx * dx + dy * dy);
                 return \`M\${d.source.x},\${d.source.y}A\${dr},\${dr} 0 0,1 \${d.target.x},\${d.target.y}\`;
            }
            return \`M\${d.source.x},\${d.source.y}L\${d.target.x},\${d.target.y}\`;
        });

        nodeGroup.attr("transform", d => \`translate(\${d.x},\${d.y})\`);
    }
    
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
    }
    
    function renderTooltip(event, d) {
        const inC = incomingCount.get(d.id) || 0;
        const outC = outgoingCount.get(d.id) || 0;
        let sub = d.summary || "";
        if (sub.length > 200) sub = sub.substring(0, 197) + "...";
        
        tooltip.html("")
            .style("left", "0px")
            .style("top", "0px")
            .style("visibility", "hidden")
            .classed("visible", true);

        tooltip.append("h3").text(d.displayName);

        const details = tooltip.append("div");
        details.append("strong").text("Kind:");
        details.append("span").text(" " + d.kind + " | ");
        details.append("strong").text("Graph:");
        details.append("span").text(" " + d.graphId);

        const connections = tooltip.append("div");
        connections.append("strong").text("Connections:");
        connections.append("span").text(" " + inC + " in, " + outC + " out");

        tooltip.append("p").text(sub);
        positionTooltip(event);
        tooltip.style("visibility", "visible");
    }

    function positionTooltip(event) {
        const tooltipElement = tooltip.node();
        if (!tooltipElement) {
            return;
        }

        const margin = 12;
        const offset = 15;
        const tooltipBounds = tooltipElement.getBoundingClientRect();
        let left = event.pageX + offset;
        let top = event.pageY + offset;
        const maxLeft = window.scrollX + window.innerWidth - tooltipBounds.width - margin;
        const maxTop = window.scrollY + window.innerHeight - tooltipBounds.height - margin;

        if (left > maxLeft) {
            left = Math.max(window.scrollX + margin, event.pageX - tooltipBounds.width - offset);
        }
        if (top > maxTop) {
            top = Math.max(window.scrollY + margin, event.pageY - tooltipBounds.height - offset);
        }

        tooltip.style("left", left + "px").style("top", top + "px");
    }

    function showTooltip(event, d) {
        if (pinnedTooltipNodeId !== null && pinnedTooltipNodeId !== d.id) {
            return;
        }

        renderTooltip(event, d);
    }
    
    function hideTooltip() {
        pinnedTooltipNodeId = null;
        tooltip.classed("visible", false).style("visibility", "hidden");
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
    
    d3.select("#search").on("input", function() {
        const term = this.value.toLowerCase().trim();
        searchHighlightNodeIds.clear();
        focusNodeId = null;
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

    updateGraph();

    const openProjectButton = d3.select("#open-project");
    if (!openProjectButton.empty()) {
        openProjectButton.on("click", async () => {
            const btn = d3.select("#open-project");
            btn.attr("disabled", "true").html('<span class="button-content"><span class="button-spinner" aria-hidden="true"></span><span class="button-label">Opening…</span></span>');
            try {
                let selectedFiles = null;
                try {
                    selectedFiles = await directoryOpen({ recursive: true });
                } catch (directoryError) {
                    if (directoryError?.name === "AbortError") {
                        btn.attr("disabled", null).html('<span class="button-content"><span class="button-label">Open...</span></span>');
                        return;
                    }
                    console.warn("Directory picker failed, falling back to file picker:", directoryError);
                }

                if (!selectedFiles || (Array.isArray(selectedFiles) && selectedFiles.length === 0)) {
                    const fileSelection = await fileOpen({
                        multiple: true,
                        extensions: [".gml", ".yyp", ".json"],
                        description: "GameMaker project files and folders"
                    });
                    selectedFiles = Array.isArray(fileSelection) ? fileSelection : [fileSelection];
                }

                const files = Array.isArray(selectedFiles) ? selectedFiles : [selectedFiles];
                if (files.length === 0) {
                    btn.attr("disabled", null).html('<span class="button-content"><span class="button-label">Open...</span></span>');
                    return;
                }

                const selectedPaths = files.map((file) =>
                    typeof file.webkitRelativePath === "string" && file.webkitRelativePath.length > 0
                        ? file.webkitRelativePath
                        : file.name
                );
                const activePath = selectedPaths[0] ?? "selected items";
                currentLoadedTarget = Object.freeze({
                    activePath,
                    source: "finder-open",
                    projectRoot: activePath,
                    selectedPaths
                });

                selectedProjectConfiguration = await loadProjectConfigurationFromFiles(files);
                renderLoadedTargetSummary();
                renderProjectConfigurationCatalog();

                btn.attr("disabled", null).html('<span class="button-content"><span class="button-label">Open...</span></span>');
            } catch (err) {
                console.error("Open project failed:", err);
                btn.attr("disabled", null).html('<span class="button-content"><span class="button-label">Error</span></span>');
            }
        });
    }

    if (IS_SERVER_MODE) {
        d3.select("#regenerate").on("click", async () => {
            const btn = d3.select("#regenerate");
            btn.attr("disabled", "true").html('<span class="button-content"><span class="button-spinner" aria-hidden="true"></span><span class="button-label">Regenerating…</span></span>');
            try {
                const res = await fetch("/api/reindex", { method: "POST" });
                if (res.ok) {
                    const payload = await res.json();
                    if (payload.changed === true) {
                        window.location.reload();
                        return;
                    }
                    btn.attr("disabled", null).html('<span class="button-content"><span class="button-label">Regenerate</span></span>');
                } else {
                    const responseText = await res.text();
                    console.error("Reindex failed", responseText);
                    btn.attr("disabled", null).html('<span class="button-content"><span class="button-label">Failed</span></span>');
                }
            } catch (err) {
                console.error(err);
                btn.attr("disabled", null).html('<span class="button-content"><span class="button-label">Error</span></span>');
            }
        });
    }`;
}
