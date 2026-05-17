import { readFile } from "node:fs/promises";

import { Parser } from "@gmloop/parser";
import type * as Refactor from "@gmloop/refactor";

/**
 * Parser bridge that adapts @gmloop/parser to the refactor engine.
 */
export class GmlParserBridge implements Refactor.ParserBridge {
    private readonly parserInstance: Refactor.ParserBridge["parse"];

    constructor(parser?: { parse(text: string): unknown }) {
        // When a custom parser is supplied (e.g. for testing), use it directly.
        // Otherwise fall back to the canonical GMLParser constructor.
        this.parserInstance = parser
            ? (source: string) => parser.parse(source)
            : (source: string) => {
                  const gmlParser = new Parser.GMLParser(source, {
                      getLocations: true,
                      simplifyLocations: true
                  });
                  return gmlParser.parse();
              };
    }

    /**
     * Parse a GML file and return a refactor-compatible AST.
     * @param filePath Path to the GML file
     */
    async parse(filePath: string): Promise<Refactor.AstNode> {
        const sourceText = await readFile(filePath, "utf8");
        const ast = await this.parserInstance(sourceText);

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
