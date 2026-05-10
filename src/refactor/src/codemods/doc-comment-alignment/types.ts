export type DocCommentAlignmentCodemodOptions = Readonly<Record<string, never>>;

export type DocCommentAlignmentEdit = Readonly<{
    start: number;
    end: number;
    text: string;
}>;

export type DocCommentAlignmentCodemodResult = Readonly<{
    changed: boolean;
    outputText: string;
    appliedEdits: ReadonlyArray<DocCommentAlignmentEdit>;
}>;
