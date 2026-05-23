/**
 * Static metadata describing a single built-in GML lint rule.
 */
export type GmlRuleDefinition = Readonly<{
    mapKey: `Gml${string}`;
    shortName: string;
    fullId: `gml/${string}`;
    messageId: string;
    schema?: ReadonlyArray<unknown>;
}>;
