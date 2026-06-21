import { isSymbolKind, parseSymbolKind, requireSymbolKind, SymbolKind, type SymbolKindValue } from "../src/types.js";
import { runEnumHelperTests } from "./test-helpers/run-enum-helper-tests.js";

runEnumHelperTests<SymbolKindValue>({
    enumName: "SymbolKind",
    typeName: "symbol kind",
    enum: SymbolKind,
    validValues: ["script", "var", "event", "macro", "enum"],
    invalidValues: ["invalid", "function", "class", "", null, undefined, 123, {}, []],
    is: isSymbolKind,
    parse: parseSymbolKind,
    require: requireSymbolKind
});
