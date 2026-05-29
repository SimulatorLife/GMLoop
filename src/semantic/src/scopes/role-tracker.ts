import type { ScopeRole } from "./types.js";

/**
 * Tracks the current identifier role during traversal (e.g., whether
 * an identifier is being used as a declaration or a reference).
 */
export class IdentifierRoleTracker {
    private identifierRoles: Array<ScopeRole>;

    constructor() {
        this.identifierRoles = [];
    }

    /**
     * Executes a callback within the context of a specific identifier role.
     */
    public withRole<T>(role: ScopeRole | null, callback: () => T): T {
        this.identifierRoles.push(role ?? {});
        try {
            return callback();
        } finally {
            this.identifierRoles.pop();
        }
    }

    /**
     * Gets the current identifier role in the stack.
     */
    public getCurrentRole(): ScopeRole | null {
        if (this.identifierRoles.length === 0) {
            return null;
        }

        return this.identifierRoles.at(-1) ?? null;
    }

    /**
     * Clones a role object for safe transfer or modification.
     */
    public cloneRole(role: ScopeRole | null): ScopeRole {
        if (!role) {
            return { type: "reference" };
        }

        const cloned = { ...role };

        if (role.tags !== undefined) {
            const sourceTags = role.tags;
            cloned.tags = Array.isArray(sourceTags) ? [...sourceTags] : [sourceTags];
        }

        // Ensure type is present on the cloned role for callers that expect
        // a fully formed role (e.g., parser identifier role usage expects a
        // `type` property to be present). Default to 'reference'.
        if (cloned.type === undefined) {
            cloned.type = "reference";
        }

        return cloned;
    }
}
