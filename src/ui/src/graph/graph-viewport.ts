export type GraphViewportCenteringInput = Readonly<{
    currentScale: number;
    targetX: number;
    targetY: number;
    viewportHeight: number;
    viewportWidth: number;
}>;

export type GraphViewportTransform = Readonly<{
    k: number;
    x: number;
    y: number;
}>;

/**
 * Compute the viewport transform needed to center a graph node while preserving zoom.
 */
export function computeViewportTransformCenteredOnNode(
    input: GraphViewportCenteringInput
): GraphViewportTransform | null {
    if (
        !Number.isFinite(input.targetX) ||
        !Number.isFinite(input.targetY) ||
        !Number.isFinite(input.viewportWidth) ||
        !Number.isFinite(input.viewportHeight)
    ) {
        return null;
    }

    const scale = Number.isFinite(input.currentScale) && input.currentScale > 0 ? input.currentScale : 1;

    return Object.freeze({
        k: scale,
        x: input.viewportWidth / 2 - input.targetX * scale,
        y: input.viewportHeight / 2 - input.targetY * scale
    });
}
