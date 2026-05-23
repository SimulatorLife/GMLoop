import { readFile } from "node:fs/promises";

import type * as Refactor from "@gmloop/refactor";

import type { ParserAdapterFactory } from "./bridge-types.js";

/**
 * Parser bridge that adapts the GML parser to the refactor engine's parser contract.
 *
 * The parser adapter is injected through the constructor so callers can supply
 * a custom parse function for testing without requiring a real GMLParser instance.
 * The default adapter factory is provided by the bridge-dependencies module, keeping
 * concrete workspace imports out of this adapter class.
 */
export class GmlParserBridge implements Refactor.ParserBridge {
    private readonly parserAdapter: (source: string) => unknown;

    /**
     * @param parserAdapterFactory - Optional factory that returns a parse function.
     *   When omitted, the caller (typically the bridge-factory) is responsible for
     *   providing the default adapter through the factory function so the bridge
     *   itself remains decoupled from the parser workspace.
     */
    constructor(parserAdapterFactory?: ParserAdapterFactory) {
        // The factory (if provided) is a factory-of-factories: it produces the
        // parse function itself, allowing callers to capture custom parser
        // configuration at the point where the concrete adapter is assembled.
        this.parserAdapter = parserAdapterFactory ? parserAdapterFactory() : () => ({ start: 0, end: 0 });
    }

    /**
     * Parse a GML file and return a refactor-compatible AST.
     * @param filePath Path to the GML file
     */
    async parse(filePath: string): Promise<Refactor.AstNode> {
        const sourceText = await readFile(filePath, "utf8");
        const ast = this.parserAdapter(sourceText);

        // Adapt the @gmloop/parser AST to @gmloop/refactor AST
        return this.adaptNode(ast);
    }

    /**
     * Recursively adapts parser nodes to the refactor engine's AST interface.
     */
    private adaptNode(node: any): Refactor.AstNode {
        if (!node || typeof node !== "object") {
            return {
                start: 0,
                end: 0
            };
        }

        const adapted: Refactor.AstNode = {
            type: node.type,
            name: node.name || (node.id && typeof node.id === "object" ? node.id.name : node.id),
            start: node.start?.index ?? 0,
            end: node.end?.index ?? 0,
            children: []
        };

        // Standard nodes often have a 'body' or 'declarations' array
        if (Array.isArray(node.body)) {
            adapted.children.push(...node.body.map((n) => this.adaptNode(n)));
        } else if (node.body && typeof node.body === "object") {
            adapted.children.push(this.adaptNode(node.body));
        }

        if (Array.isArray(node.declarations)) {
            adapted.children.push(...node.declarations.map((n) => this.adaptNode(n)));
        }

        // Handle common expression properties
        for (const prop of [
            "init",
            "left",
            "right",
            "argument",
            "test",
            "consequent",
            "alternate",
            "object",
            "property",
            "expression"
        ]) {
            if (node[prop] && typeof node[prop] === "object") {
                adapted.children.push(this.adaptNode(node[prop]));
            }
        }

        // Handle arrays of arguments or elements
        if (Array.isArray(node.arguments)) {
            adapted.children.push(...node.arguments.map((n) => this.adaptNode(n)));
        }

        if (Array.isArray(node.elements)) {
            adapted.children.push(...node.elements.map((n) => this.adaptNode(n)));
        }

        return adapted;
    }
}
