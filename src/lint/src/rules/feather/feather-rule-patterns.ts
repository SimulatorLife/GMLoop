/**
 * Character class covering any whitespace that is not a newline. Composed
 * into the regex constants below so they share a single source of truth for
 * what counts as "horizontal" whitespace when scanning tokens.
 */
const NON_NEWLINE_WHITESPACE_CHARACTER_CLASS = String.raw`[\t\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]`;

export const ENUM_MEMBER_DECLARATION_PATTERN = new RegExp(
    String.raw`^(?<name>[A-Za-z_][A-Za-z0-9_]*)(?<initializer>\s*=\s*(?:[^\s,][^,\n]*|${NON_NEWLINE_WHITESPACE_CHARACTER_CLASS}))?(?<suffix>\s*(?:,\s*)?(?:\/\/.*)?)$`,
    "u"
);

export const DIVISION_BY_ZERO_ASSIGNMENT_PATTERN = new RegExp(
    String.raw`(\b[A-Za-z_]\w*\s*=\s*(?:[^\s/;][^;\n/]*|${NON_NEWLINE_WHITESPACE_CHARACTER_CLASS}))\s*\/\s*0\b`,
    "g"
);

export const LEADING_EQUALS_ARTIFACT_PATTERN = new RegExp(
    String.raw`^=\s*(?:\S.*|${NON_NEWLINE_WHITESPACE_CHARACTER_CLASS});\s*$`,
    "u"
);

export const GPU_ALPHA_TEST_TRUE_SPACING_PATTERN = new RegExp(
    String.raw`(\bgpu_set_alphatestenable\s*\(\s*true\s*\)\s*;)${NON_NEWLINE_WHITESPACE_CHARACTER_CLASS}*\n\s*\n(\s*[^\s])`,
    "g"
);

export const BRACKETED_INDEX_LIST_PATTERN = new RegExp(
    String.raw`\[(?!\s*#)([^,\]\n]+(?:\s*,\s*(?:[^\s,\]][^,\]\n]*|${NON_NEWLINE_WHITESPACE_CHARACTER_CLASS}))+)]`,
    "g"
);

export const VERTEX_BEGIN_WITHOUT_END_PATTERN = new RegExp(
    String.raw`(vertex_begin\(vb,\s*format\);${NON_NEWLINE_WHITESPACE_CHARACTER_CLASS}*\n\s*vertex_position_3d\([^\n]+\);\s*)`,
    "m"
);

export const DUPLICATE_GPU_PUSH_STATE_PATTERN = new RegExp(
    String.raw`gpu_push_state\(\);${NON_NEWLINE_WHITESPACE_CHARACTER_CLASS}*\n\s*gpu_push_state\(\);`,
    "g"
);

export const DUPLICATE_GPU_POP_STATE_PATTERN = new RegExp(
    String.raw`gpu_pop_state\(\);${NON_NEWLINE_WHITESPACE_CHARACTER_CLASS}*\n\s*gpu_pop_state\(\);`,
    "g"
);
