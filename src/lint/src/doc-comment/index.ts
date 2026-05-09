import { Core } from "@gmloop/core";

// Re-export comment utility helpers from Core that are consumed by transform
// modules. Having them visible at the doc-comment namespace avoids deep Core
// imports in transform layers. Explicit type annotations ensure portable type
// references.
const hasCommentImmediatelyBefore: (text: unknown, index: unknown) => boolean = Core.hasCommentImmediatelyBefore;
const isDocLikeLeadingLine: (value: unknown) => boolean = Core.isDocLikeLeadingLine;

export * from "./collection.js";
export * from "./deprecated.js";
export * from "./documented-params.js";
export * from "./legacy.js";
export * from "./manager.js";
export * from "./metadata.js";
export * from "./synthetic-generation.js";
export * from "./synthetic-helpers.js";
export * from "./synthetic-merge.js";

export { hasCommentImmediatelyBefore, isDocLikeLeadingLine };
