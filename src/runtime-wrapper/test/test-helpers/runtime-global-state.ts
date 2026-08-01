/**
 * Captures the current values of the selected properties on {@link globalThis}.
 */
export function snapshotGlobalProperties<PropertyName extends string>(
    propertyNames: ReadonlyArray<PropertyName>
): Record<PropertyName, unknown> {
    const globals = globalThis as Record<PropertyName, unknown>;
    const snapshot = Object.create(null) as Record<PropertyName, unknown>;

    for (const propertyName of propertyNames) {
        snapshot[propertyName] = globals[propertyName];
    }

    return snapshot;
}

/**
 * Restores a snapshot previously captured with {@link snapshotGlobalProperties}.
 */
export function restoreGlobalProperties<PropertyName extends string>(snapshot: Record<PropertyName, unknown>): void {
    const globals = globalThis as Record<PropertyName, unknown>;

    for (const propertyName of Object.keys(snapshot) as Array<PropertyName>) {
        const value = snapshot[propertyName];

        if (value === undefined) {
            delete globals[propertyName];
            continue;
        }

        globals[propertyName] = value;
    }
}
