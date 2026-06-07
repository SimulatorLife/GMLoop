/// @desc legacy style line
/// Keep me
/// @param x
/// @returns {undefined}
function test(x) {}
/// @param a
/// @param [b=1]
/// @returns {any}
function synth_me(_a, b = 1) {
    return _a + b;
}

/// @desc Existing docs
/// @param alpha
/// @param beta
/// @returns {any}
function enrich_me(alpha, beta) {
    return alpha + beta;
}

/// @param alpha
/// @param [beta]
/// @returns {any}
function enrich_me2(alpha, beta = undefined) {
    return alpha + beta;
}

/// @param value
/// @returns {Struct}
var build_struct = function (value) {
    return { value: value };
};

/// @param kind
/// @param [amount=1]
/// @returns {any}
static step_once = function (_kind, amount = 1) {
    return amount;
};

/// @returns {undefined}
function func_undefined() {
    return undefined;
}

/// @param {function} [x]
/// @returns {any}
var func_default_callback = function (x = function() { return 1; }) {
    return x();
};

/// @desc Updates movement for the active player.
/// @param [angle=90] Current heading in degrees.
/// @customTag keep this custom metadata
/// @param speed The per-step speed scalar.
/// @returns {undefined}
function update_movement(angle = 90, speed) {
    return;
}

/// @param first first description should stay attached to first.
/// @internal custom annotation users may provide
/// @param second second description should stay attached to second.
/// @param third third description should stay attached to third.
/// @returns {undefined}
function reorder_with_descriptions(first, second, third) {
    return;
}

/// @deprecated use build_packet_v2
/// @param alpha Existing alpha description should stay attached.
/// @custom preserve me
/// @param [beta=4] Existing beta description should stay attached.
/// @returns {undefined}
var build_packet = function (alpha, beta = 4) {
    return;
};

/// @param {Struct.MyCustomStruct} custom Struct payload should retain namespaced type.
/// @param {string} name Player display name should retain {string}.
/// @returns {undefined}
function typed_reorder(custom, name) {
    return;
}

/// @param {Struct.MyCustomStruct} custom Main custom struct payload.
/// @param {real} score Numeric score payload.
/// @returns {undefined}
function typed_aliases(custom, score) {
    return;
}

/// @param {Struct.MyCustomStruct} custom Existing type should be preserved.
/// @param count Existing untyped param should remain valid.
/// @returns {undefined}
function typed_and_untyped(custom, count) {
    return;
}

/// @returns {undefined}
function no_returns_no_docs() {
    var x = 1;
    x += 1;
}

/// @returns {undefined}
function bare_return_only() {
    return;
}

/// @returns {undefined}
function explicit_undefined_return_only() {
    return undefined;
}

/// @returns {real}
function returns_concrete_literal() {
    return 42;
}

/// @param flag
/// @returns {real|undefined}
function returns_concrete_in_branch(flag) {
    if (flag) {
        return 1;
    }

    return;
}

/// @returns {undefined}
function typed_returns_metadata() {
    return;
}

/// @returns {undefined}
function legacy_typed_return_alias() {
    return;
}

/// @returns {undefined}
function typed_union_return_metadata() {
    return;
}

/// @param {real} [angle=90]
/// @returns {real}
function update_movement_typed_return(angle = 90) {
    return angle;
}

/// @param [angle=90]
/// @returns {any}
function update_movement_untyped_return(angle = 90) {
    return angle;
}

var assigned_returns_concrete = function () {
    return "ok";
};

/// @param seed
/// @returns {any}
function local_assignment_container(seed) {
    var assigned_returns_concrete_local = function () {
        return "ok";
    };

    var assigned_returns_undefined_local = function () {
        return;
    };

    var assigned_no_return_with_params = function (value, count = 2) {
        var total = value + count;
    };

    /// @param value Local documented param should normalize.
    /// @returns {real}
    var local_documented_alias = function (_value) {
        return _value;
    };

    /// @param {Struct.MyCustomStruct} [first] first typed description should remain.
    /// @custom local annotations should stay.
    /// @param second second description should remain.
    /// @returns {undefined}
    var local_documented_reorder = function (first = undefined, second) {
        return;
    };

    /// @desc local legacy docs should canonicalize
    /// @param amount
    /// @returns {undefined}
    var local_legacy_double_slash = function (amount) {
        return;
    };

    return seed;
}

var assigned_local_with_params = function (left, right = 10) {
    var total = left + right;
};

/// @param left
/// @param [right=10]
/// @returns {undefined}
var assigned_local_with_params = function (left, right = 10) {
    var total = left + right;
};

var assigned_local_with_explicit_undefined = function () {
    return undefined;
};

/// @param name
/// @param [hp=100]
function build_enemy_struct(name, hp = 100) {
    return {
        name: name,
        hp: hp,
/// @param amount
/// @returns {undefined}
        heal: function (amount) {
            hp += amount;
        },
        label: function () {
            return string(name);
        }
    };
}

/// @param type
/// @param [speed=4]
/// @returns {undefined}
function EnemyConfig(_type, _speed = 4) : EntityConfig(_speed) constructor {
    type = _type;
    speed = _speed;
    setup = function (state) {
        current_state = state;
    };

    /// @override
    /// @returns {void}
    static step = function() {}
}
