import { createInitialGraphVisualizationUiState, reduceGraphVisualizationUiState } from "./reducer.js";
import type { GraphVisualizationUiAction, GraphVisualizationUiState } from "./types.js";

export type GraphVisualizationUiStateListener = (state: GraphVisualizationUiState) => void;

/**
 * Mutable store wrapper around the graph visualization state reducer.
 */
export class GraphVisualizationUiStore {
    #listeners = new Set<GraphVisualizationUiStateListener>();

    #state: GraphVisualizationUiState;

    public constructor(initialState: GraphVisualizationUiState = createInitialGraphVisualizationUiState()) {
        this.#state = initialState;
    }

    /**
     * Read the current immutable UI state.
     */
    public getState(): GraphVisualizationUiState {
        return this.#state;
    }

    /**
     * Dispatch a state transition action.
     */
    public dispatch(action: GraphVisualizationUiAction): void {
        const nextState = reduceGraphVisualizationUiState(this.#state, action);
        if (nextState === this.#state) {
            return;
        }

        this.#state = nextState;
        for (const listener of this.#listeners) {
            listener(this.#state);
        }
    }

    /**
     * Subscribe to state updates.
     */
    public subscribe(listener: GraphVisualizationUiStateListener): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }
}
