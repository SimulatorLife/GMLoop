/**
 * Stable Core helper contract for lint doc-comment modules.
 *
 * Doc-comment transformation and metadata modules depend on a small set of
 * helpers from `@gmloop/core` (isFunctionLikeNode, normalizeParamDocType,
 * hasCommentImmediatelyBefore, isDocLikeLeadingLine). Rather than importing
 * Core directly from every consumer module, they depend on this service object
 * so the surface area is explicit and only these four helpers are exposed.
 *
 * If Core's API surface changes, only this file needs updating — downstream
 * doc-comment consumers stay stable.
 */
import { Core } from "@gmloop/core";

type HasCommentImmediatelyBeforeFn = (text: unknown, index: unknown) => boolean;
type IsDocLikeLeadingLineFn = (value: unknown) => boolean;
type IsFunctionLikeNodeFn = (node: unknown) => boolean;
type NormalizeParamDocTypeFn = (typeName: string) => string;

export interface DocCommentCoreServices {
    readonly hasCommentImmediatelyBefore: HasCommentImmediatelyBeforeFn;
    readonly isDocLikeLeadingLine: IsDocLikeLeadingLineFn;
    readonly isFunctionLikeNode: IsFunctionLikeNodeFn;
    readonly normalizeParamDocType: NormalizeParamDocTypeFn;
}

export const docCommentCoreServices: DocCommentCoreServices = Object.freeze({
    hasCommentImmediatelyBefore: Core.hasCommentImmediatelyBefore,
    isDocLikeLeadingLine: Core.isDocLikeLeadingLine,
    isFunctionLikeNode: Core.isFunctionLikeNode,
    normalizeParamDocType: Core.normalizeParamDocType
});
