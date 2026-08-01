import { mountGraphVisualizationWebApp } from "./index.js";

function assertRootElement(): HTMLElement {
    const rootElement = document.getElementById("root");
    if (!(rootElement instanceof HTMLElement)) {
        throw new TypeError("Expected a #root element for graph visualization web app bootstrap.");
    }
    return rootElement;
}

mountGraphVisualizationWebApp(assertRootElement());
