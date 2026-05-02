import { bootstrapGraphVisualizationApp, type BrowserAppDependencies } from "./graph-visualization-browser-app.js";

/**
 * Lifecycle surface for mounting the graph visualization runtime in UI component hosts.
 */
export type GraphVisualizationEngineAdapter = Readonly<{
    dispose(): void;
    mount(): void;
    update(dependencies: BrowserAppDependencies): void;
}>;

function resetGraphVisualizationDomState(): void {
    const appShell = document.getElementById("app-shell");
    const parent = appShell?.parentElement;
    if (!(appShell instanceof HTMLElement) || parent === null) {
        return;
    }

    const replacementShell = appShell.cloneNode(true);
    appShell.replaceWith(replacementShell);
}

/**
 * Create an imperative graph engine adapter with lifecycle hooks for UI frameworks.
 */
export function createGraphVisualizationEngineAdapter(
    initialDependencies: BrowserAppDependencies
): GraphVisualizationEngineAdapter {
    let dependencies = initialDependencies;
    let mounted = false;

    const mount = (): void => {
        if (mounted) {
            return;
        }
        bootstrapGraphVisualizationApp(dependencies);
        mounted = true;
    };

    const dispose = (): void => {
        if (!mounted) {
            return;
        }

        resetGraphVisualizationDomState();
        mounted = false;
    };

    const update = (nextDependencies: BrowserAppDependencies): void => {
        dependencies = nextDependencies;
        if (!mounted) {
            return;
        }

        dispose();
        mount();
    };

    return Object.freeze({
        dispose,
        mount,
        update
    });
}
