/**
 * Tracks comment ranges so transforms can temporarily re-order or remove statements without losing annotations.
 */
import { Core } from "@gmloop/core";

interface CommentLike {
    _removedByConsolidation?: boolean;
    _structPropertyTrailing?: boolean;
    _structPropertyHandled?: boolean;
    leading?: boolean;
    trailing?: boolean;
    placement?: string;
    leadingChar?: string;
    enclosingNode?: unknown;
    precedingNode?: unknown;
    followingNode?: unknown;
}

interface CommentTrackerEntry {
    index: number;
    comment: CommentLike;
    consumed: boolean;
}

function resolveCommentStartIndex(comment: unknown): number | null {
    const directStartIndex = Core.getCommentBoundaryIndex(comment, "start");
    if (typeof directStartIndex === "number") {
        return directStartIndex;
    }

    const fallbackStartIndex = Core.getNodeStartIndex(comment);
    return typeof fallbackStartIndex === "number" ? fallbackStartIndex : null;
}

function createCommentTrackerEntries(sourceComments: ReadonlyArray<unknown>): Array<CommentTrackerEntry> {
    return sourceComments
        .flatMap((comment) => {
            const index = resolveCommentStartIndex(comment);
            return typeof index === "number" ? [{ index, comment, consumed: false }] : [];
        })
        .toSorted((left, right) => left.index - right.index);
}

function isValidCommentRange(left: number | undefined, right: number | undefined): left is number {
    return typeof left === "number" && typeof right === "number" && left < right;
}

/**
 * Keeps a sorted view of comment locations and supports checkpoint/rollback to safely explore rewrites.
 */
export class CommentTracker {
    public comments: Array<CommentLike>;
    public entries: Array<CommentTrackerEntry>;

    private checkpoints: Array<Array<CommentTrackerEntry>> = [];

    constructor(ownerOrComments: unknown) {
        const sourceComments = Array.isArray(ownerOrComments) ? ownerOrComments : Core.getCommentArray(ownerOrComments);

        this.comments = sourceComments as Array<CommentLike>;
        this.entries = createCommentTrackerEntries(sourceComments);
    }

    checkpoint(): void {
        this.checkpoints.push(Core.cloneObjectEntries(this.entries));
    }

    rollback(): void {
        const previousEntries = this.checkpoints.pop();
        if (previousEntries) {
            this.entries = previousEntries;
        }
    }

    commit(): void {
        this.checkpoints.pop();
    }

    hasBetween(left: number | undefined, right: number | undefined): boolean {
        return this.getUnconsumedEntriesBetween(left, right).length > 0;
    }

    hasAfter(position: number | undefined): boolean {
        if (this.entries.length === 0 || typeof position !== "number") {
            return false;
        }

        return this.entries.slice(this.firstGreaterThan(position)).some((entry) => !entry.consumed);
    }

    takeBetween(
        left: number | undefined,
        right: number | undefined,
        predicate?: (comment: unknown) => boolean
    ): Array<CommentLike> {
        if (this.entries.length === 0 || typeof left !== "number") {
            return [];
        }

        const upperBound = typeof right === "number" ? right : Number.POSITIVE_INFINITY;
        if (left >= upperBound) {
            return [];
        }

        const startIndex = this.firstGreaterThan(left);
        const takenComments: Array<CommentLike> = [];
        const remainingEntries = this.entries.slice(0, startIndex);

        for (const entry of this.entries.slice(startIndex)) {
            if (entry.index >= upperBound) {
                remainingEntries.push(entry);
                continue;
            }

            if (predicate && !predicate(entry.comment)) {
                remainingEntries.push(entry);
                continue;
            }

            takenComments.push(entry.comment);
        }

        this.entries = remainingEntries;
        return takenComments;
    }

    firstGreaterThan(target: number): number {
        let low = 0;
        let high = this.entries.length - 1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (this.entries[mid].index <= target) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return low;
    }

    getEntriesBetween(left: number | undefined, right: number | undefined): Array<CommentTrackerEntry> {
        return this.getUnconsumedEntriesBetween(left, right);
    }

    consumeEntries(entries: Array<CommentTrackerEntry | CommentLike | null | undefined>): void {
        for (const entry of entries) {
            if (!entry) {
                continue;
            }

            const trackerEntry = this.findEntryForConsumedComment(entry);
            const comment = trackerEntry?.comment ?? (entry as CommentLike);
            comment._removedByConsolidation = true;

            if (trackerEntry) {
                trackerEntry.consumed = true;
            }
        }
    }

    removeConsumedComments(): void {
        if (this.comments.length === 0) {
            return;
        }

        let writeIndex = 0;
        for (const comment of this.comments) {
            if (comment._removedByConsolidation) {
                continue;
            }

            this.comments[writeIndex] = comment;
            writeIndex += 1;
        }

        this.comments.length = writeIndex;
    }

    private getUnconsumedEntriesBetween(
        left: number | undefined,
        right: number | undefined
    ): Array<CommentTrackerEntry> {
        if (!isValidCommentRange(left, right) || this.entries.length === 0) {
            return [];
        }

        const matchingEntries: Array<CommentTrackerEntry> = [];
        for (const entry of this.entries.slice(this.firstGreaterThan(left))) {
            if (entry.index >= right) {
                break;
            }

            if (!entry.consumed) {
                matchingEntries.push(entry);
            }
        }

        return matchingEntries;
    }

    private findEntryForConsumedComment(entry: CommentTrackerEntry | CommentLike): CommentTrackerEntry | undefined {
        if (this.isTrackerEntry(entry)) {
            return entry;
        }

        return this.entries.find((candidate) => candidate.comment === entry);
    }

    private isTrackerEntry(entry: CommentTrackerEntry | CommentLike): entry is CommentTrackerEntry {
        return (
            Core.isObjectLike(entry) && typeof (entry as { index?: unknown }).index === "number" && "comment" in entry
        );
    }
}
