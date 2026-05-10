/**
 * Doc-comment namespace for GML lint transformation and metadata modules.
 *
 * This module aggregates and re-exports the public API of the doc-comment
 * subdirectory. High-traffic Core helpers (isFunctionLikeNode,
 * normalizeParamDocType, hasCommentImmediatelyBefore, isDocLikeLeadingLine) are
 * obtained from the `docCommentCoreServices` service rather than imported
 * directly from `@gmloop/core`, keeping the Core dependency surface explicit
 * and bounded. Callers can destructure these helpers from this namespace or
 * import them individually from the submodules.
 */
import { services } from "../services/index.js";

type HasCommentImmediatelyBeforeFn = (text: unknown, index: unknown) => boolean;
type IsDocLikeLeadingLineFn = (value: unknown) => boolean;
type IsFunctionLikeNodeFn = (node: unknown) => boolean;
type NormalizeParamDocTypeFn = (typeName: string) => string;

const hasCommentImmediatelyBefore: HasCommentImmediatelyBeforeFn =
    services.docCommentCoreServices.hasCommentImmediatelyBefore;
const isDocLikeLeadingLine: IsDocLikeLeadingLineFn = services.docCommentCoreServices.isDocLikeLeadingLine;
const isFunctionLikeNode: IsFunctionLikeNodeFn = services.docCommentCoreServices.isFunctionLikeNode;
const normalizeParamDocType: NormalizeParamDocTypeFn = services.docCommentCoreServices.normalizeParamDocType;

export * from "./collection.js";
export * from "./deprecated.js";
export * from "./documented-params.js";
export * from "./legacy.js";
export * from "./manager.js";
export * from "./metadata.js";
export * from "./synthetic-generation.js";
export * from "./synthetic-helpers.js";
export * from "./synthetic-merge.js";

export { hasCommentImmediatelyBefore, isDocLikeLeadingLine, isFunctionLikeNode, normalizeParamDocType };
