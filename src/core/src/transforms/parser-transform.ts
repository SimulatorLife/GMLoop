import type { MutableGameMakerAstNode } from "../ast/types.js";

/**
 * Shared base for parser transforms so each transform follows a consistent API.
 */
type TransformOptions = Record<string, unknown>;
export type EmptyTransformOptions = Record<string, never>;

/**
 * Minimal interface implemented by transforms that mutate a GML AST in a predictable way.
 */
export interface ParserTransform<
    AstType extends MutableGameMakerAstNode = MutableGameMakerAstNode,
    Options extends TransformOptions = TransformOptions
> {
    readonly name: string;
    readonly defaultOptions: Options;
    transform(ast: AstType, options?: Options): AstType;
}

/**
 * Factory function that creates a transform object from a name, default options, and implementation.
 *
 * The default options are shallow-frozen so callers can safely merge them with
 * user-provided overrides without mutating the shared defaults.
 */
export function createParserTransform<Options extends TransformOptions = TransformOptions>(
    name: string,
    defaultOptions: Options,
    execute: (ast: MutableGameMakerAstNode, options: Options) => MutableGameMakerAstNode
): ParserTransform<MutableGameMakerAstNode, Options> {
    const frozenDefaults = Object.freeze({ ...defaultOptions }) as Options;

    return {
        name,
        defaultOptions: frozenDefaults,
        transform(ast: MutableGameMakerAstNode, options?: Options): MutableGameMakerAstNode {
            return execute(ast, options === undefined ? frozenDefaults : { ...frozenDefaults, ...options });
        }
    };
}
