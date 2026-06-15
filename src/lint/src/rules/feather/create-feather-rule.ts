import type { Rule } from "eslint";

import type { FeatherRuleFactory } from "./feather-rule-types.js";
import type { FeatherManifestEntry } from "./manifest.js";
import {
    createGm1000Rule,
    createGm1002Rule,
    createGm1003Rule,
    createGm1004Rule,
    createGm1005Rule,
    createGm1007Rule,
    createGm1008Rule,
    createGm1009Rule,
    createGm1010Rule,
    createGm1012Rule,
    createGm1013Rule,
    createGm1014Rule,
    createGm1015Rule,
    createGm1016Rule,
    createGm1017Rule,
    createGm1021Rule,
    createGm1023Rule,
    createGm1024Rule,
    createGm1026Rule,
    createGm1028Rule,
    createGm1029Rule,
    createGm1030Rule,
    createGm1032Rule,
    createGm1033Rule,
    createGm1034Rule,
    createGm1036Rule,
    createGm1038Rule,
    createGm1041Rule,
    createGm1051Rule,
    createGm1052Rule,
    createGm1054Rule,
    createGm1056Rule,
    createGm1058Rule,
    createGm1059Rule,
    createGm1062Rule,
    createGm1063Rule,
    createGm1064Rule,
    createGm1100Rule,
    createGm2000Rule,
    createGm2003Rule,
    createGm2004Rule,
    createGm2005Rule,
    createGm2007Rule,
    createGm2008Rule,
    createGm2009Rule,
    createGm2011Rule,
    createGm2012Rule,
    createGm2015Rule,
    createGm2020Rule,
    createGm2023Rule,
    createGm2025Rule,
    createGm2026Rule,
    createGm2028Rule,
    createGm2029Rule,
    createGm2030Rule,
    createGm2031Rule,
    createGm2032Rule,
    createGm2033Rule,
    createGm2035Rule,
    createGm2040Rule,
    createGm2042Rule,
    createGm2043Rule,
    createGm2044Rule,
    createGm2046Rule,
    createGm2048Rule,
    createGm2050Rule,
    createGm2051Rule,
    createGm2052Rule,
    createGm2053Rule,
    createGm2054Rule,
    createGm2056Rule,
    createGm2061Rule,
    createGm2064Rule
} from "./rules/index.js";

const featherRuleFactoriesById: ReadonlyMap<string, FeatherRuleFactory> = new Map([
    ["GM1000", createGm1000Rule],
    ["GM1002", createGm1002Rule],
    ["GM1003", createGm1003Rule],
    ["GM1004", createGm1004Rule],
    ["GM1005", createGm1005Rule],
    ["GM1007", createGm1007Rule],
    ["GM1008", createGm1008Rule],
    ["GM1009", createGm1009Rule],
    ["GM1010", createGm1010Rule],
    ["GM1012", createGm1012Rule],
    ["GM1014", createGm1014Rule],
    ["GM1015", createGm1015Rule],
    ["GM1016", createGm1016Rule],
    ["GM1017", createGm1017Rule],
    ["GM1021", createGm1021Rule],
    ["GM1023", createGm1023Rule],
    ["GM1024", createGm1024Rule],
    ["GM1026", createGm1026Rule],
    ["GM1028", createGm1028Rule],
    ["GM1029", createGm1029Rule],
    ["GM1030", createGm1030Rule],
    ["GM1033", createGm1033Rule],
    ["GM1038", createGm1038Rule],
    ["GM1041", createGm1041Rule],
    ["GM1051", createGm1051Rule],
    ["GM1052", createGm1052Rule],
    ["GM1054", createGm1054Rule],
    ["GM1058", createGm1058Rule],
    ["GM1063", createGm1063Rule],
    ["GM1064", createGm1064Rule],
    ["GM1100", createGm1100Rule],
    ["GM1013", createGm1013Rule],
    ["GM1032", createGm1032Rule],
    ["GM1034", createGm1034Rule],
    ["GM1036", createGm1036Rule],
    ["GM1056", createGm1056Rule],
    ["GM1059", createGm1059Rule],
    ["GM1062", createGm1062Rule],
    ["GM2000", createGm2000Rule],
    ["GM2003", createGm2003Rule],
    ["GM2009", createGm2009Rule],
    ["GM2004", createGm2004Rule],
    ["GM2005", createGm2005Rule],
    ["GM2007", createGm2007Rule],
    ["GM2008", createGm2008Rule],
    ["GM2011", createGm2011Rule],
    ["GM2012", createGm2012Rule],
    ["GM2015", createGm2015Rule],
    ["GM2020", createGm2020Rule],
    ["GM2023", createGm2023Rule],
    ["GM2025", createGm2025Rule],
    ["GM2026", createGm2026Rule],
    ["GM2028", createGm2028Rule],
    ["GM2029", createGm2029Rule],
    ["GM2032", createGm2032Rule],
    ["GM2030", createGm2030Rule],
    ["GM2031", createGm2031Rule],
    ["GM2033", createGm2033Rule],
    ["GM2035", createGm2035Rule],
    ["GM2040", createGm2040Rule],
    ["GM2042", createGm2042Rule],
    ["GM2043", createGm2043Rule],
    ["GM2044", createGm2044Rule],
    ["GM2046", createGm2046Rule],
    ["GM2048", createGm2048Rule],
    ["GM2050", createGm2050Rule],
    ["GM2051", createGm2051Rule],
    ["GM2052", createGm2052Rule],
    ["GM2053", createGm2053Rule],
    ["GM2054", createGm2054Rule],
    ["GM2056", createGm2056Rule],
    ["GM2061", createGm2061Rule],
    ["GM2064", createGm2064Rule]
]);

function createReportOnlyRuleContext(context: Rule.RuleContext): Rule.RuleContext {
    const report = (descriptor: Rule.ReportDescriptor): void => {
        const { fix: _fix, suggest: _suggest, ...reportOnlyDescriptor } = descriptor;
        context.report(reportOnlyDescriptor);
    };

    return new Proxy(Object.create(null) as object, {
        get(_target, property) {
            return property === "report" ? report : Reflect.get(context, property);
        }
    }) as Rule.RuleContext;
}

function createReportOnlyFeatherRule(rule: Rule.RuleModule): Rule.RuleModule {
    const meta = rule.meta;
    let reportOnlyMeta: Rule.RuleMetaData | undefined;
    if (meta !== undefined) {
        const { fixable: _fixable, hasSuggestions: _hasSuggestions, ...remainingMeta } = meta;
        reportOnlyMeta = Object.freeze(remainingMeta);
    }

    return Object.freeze({
        ...(reportOnlyMeta === undefined ? {} : { meta: reportOnlyMeta }),
        create(context) {
            return rule.create(createReportOnlyRuleContext(context));
        }
    });
}

export function createFeatherRule(entry: FeatherManifestEntry): Rule.RuleModule {
    const createRule = featherRuleFactoriesById.get(entry.id);
    if (createRule) {
        const rule = createRule(entry);
        return entry.fixability === "none" ? createReportOnlyFeatherRule(rule) : rule;
    }

    throw new Error(`Missing feather rule implementation for id '${entry.id}'.`);
}
