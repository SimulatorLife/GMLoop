/// @description Absorption law: (foo or (foo and bar)) == foo.
/// @param {bool} foo
/// @param {bool} bar
/// @returns {bool}
function scr_logic_absorption_or(foo, bar) {
    return foo;
}

/// @param {bool} condition
/// @returns {bool}
function bool_with_extra(condition) {
    return condition;
}

/// @description Absorption law: (foo and (foo or bar)) == foo.
/// @param {bool} foo
/// @param {bool} bar
/// @returns {bool}
function scr_logic_absorption_and(foo, bar) {
    return foo;
}

/// @description Distributive factoring: (foo and bar) or (foo and baz) == foo and (bar or baz).
/// @param {bool} foo
/// @param {bool} bar
/// @param {bool} baz
/// @returns {bool}
function scr_logic_factor_shared_and(foo, bar, baz) {
    return foo and (bar or baz);
}

/// @description Consensus simplification: (foo and bar) or (!foo and bar) == bar.
/// @param {bool} foo
/// @param {bool} bar
/// @returns {bool}
function scr_logic_factor_shared_or(foo, bar) {
    return bar;
}

/// @description XOR equivalence: (foo and !bar) or (!foo and bar).
/// @param {bool} foo
/// @param {bool} bar
/// @returns {bool}
function scr_logic_xor_equivalent(foo, bar) {
    return foo != bar;
}

/// @description Guard extraction: (foo and qux) or (bar and qux) or (baz and qux).
/// @param {bool} foo
/// @param {bool} bar
/// @param {bool} baz
/// @param {bool} qux
/// @returns {bool}
function scr_logic_guard_extraction(foo, bar, baz, qux) {
    return (foo or bar or baz) and qux;
}

/// @description Implication: if (foo) return bar; else return true.
/// @param {bool} foo
/// @param {bool} bar
/// @returns {bool}
function scr_logic_implication_form(foo, bar) {
    return (!foo) or bar;
}

/// @description De Morgan’s law: !(foo or bar) == !foo and !bar.
/// @param {bool} foo
/// @param {bool} bar
/// @returns {bool}
function scr_logic_demorgan_and(foo, bar) {
    return (!foo) and (!bar);
}

/// @description De Morgan’s law: !(foo and bar) == !foo or !bar.
/// @param {bool} foo
/// @param {bool} bar
/// @returns {bool}
function scr_logic_demorgan_or(foo, bar) {
    return (!foo) or (!bar);
}

/// @description Original multi-branch: if (foo and bar or baz) return (foo and bar); else return (foo or baz).
/// @param {bool} foo
/// @param {bool} bar
/// @param {bool} baz
/// @returns {bool}
function scr_logic_branch_collapse(foo, bar, baz) {
    return (foo and bar) or baz;
}

/// @description Multi-clause reduction: (foo or bar) and (!foo or baz) and (!bar or baz).
/// @param {bool} foo
/// @param {bool} bar
/// @param {bool} baz
/// @returns {bool}
function scr_logic_mixed_reduction(foo, bar, baz) {
    return (foo and bar) or baz;
}

/// @param foo
/// @param bar
/// @param baz
function logical_example(foo, bar, baz) {
    return (foo and bar) or baz;
}

/// @description Takes a real number and returns the nearest power of 2, including negative powers for negative values.
/// @param {real} value - The real number to find the nearest power of 2 for.
/// @returns {real} The nearest power of 2
function scr_nearest_power_of_2(value) {
    if (value == 0) {
        return 0;
    }

    return power(2, round(log2(abs(value)))) * sign(value);
}

/// @returns {undefined}
function scr_verbose_assignment() {
    sprite_index = scr_custom_condition() ? spr_enemy_alerted : spr_enemy_idle;
}

/// @returns {any}
function scr_verbose_return() {
    return scr_custom_condition() ? obj_enemy : obj_player;
}
