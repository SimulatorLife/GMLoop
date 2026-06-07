/// @param value
function my_custom_struct(_value) constructor {
    value = _value;
}

/// @param foo
/// @param value
function child_struct(_foo, _value) : my_custom_struct(_value) constructor {
    self.foo = _foo;
    value = 0;

    /// @desc Print a debug message showing foo value
    /// @returns {undefined}
    static print = function () {
        show_debug_message($"My foo is {self.foo}");
    };

    /// @desc Each time this is called, create new map
    /// @returns {undefined}
    static generate = function () {
        points = poisson_disk_sample(width, height, point_space);
        create_nodes_from_points();
        remove_ellipse();
    };

    /// @desc Remove all nodes outside of ellipse
    /// @returns {undefined}
    static remove_ellipse = function () {
        var len = array_length(nodes);
        for (var i = 0; i < len; i++) {
            if (!collision_ellipse(0, 0, width, height, nodes[i], false, true)) {
                instance_destroy(nodes[i]);
            }
        }
    };

    /// @desc Draw points in array for debugging
    /// @returns {undefined}
    static draw_points = function () {
        var num_points = array_length(points);
        for (var i = 0; i < num_points; i++) {
            draw_circle(points[i].x, points[i].y, 2, false);
        }
    };
}

/// @param foo
/// @param value
/// @param bar
function grandchild_struct(_foo, _value, _bar) : child_struct(_foo, _value) constructor {
    self.foo = _foo;
    value = 0;
    bar = _bar;

    /// @returns {undefined}
    static print = function () {
        show_debug_message($"I'm a grandchild struct and my foo is {self.foo}");
    };

    /// @override
    /// @returns {undefined}
    static draw_points = function () {
        // Do nothing
    };
}

// Print function with different scope
var print = function () {
    show_debug_message("This is a different print function");
};

/// @returns {Struct}
function keep_separate() {
    var foo = {};
    // the assignments below depend on runtime
    foo.bar = 1;
    foo.baz = 2;
    if (should_apply()) {
        foo.qux = 3;
    }
    return foo;
}

/// @returns {Struct}
function trailing_comment() {
    return {
        hp: 100, // base health
        mp: 50
    };
}

/// @param value
/// @returns {Struct}
function dynamic_index(value) {
    var obj = {static_key: value};
    obj[$ get_key()] = value;
    return obj;
}

/// @param value
/// @returns {Struct}
function make_struct(value) {
    return {alpha: 1, beta: value, gamma: call()};
}

/// @returns {undefined}
function reuse_struct() {
    instance = {name: "example", score: 42};
    do_something(instance);
}

/// @desc This function has a sideffect of defining an instance variable 'data' that must be preserved
/// @returns {Struct}
function assign_then_extend() {
    data = {label: "ok", value: 123};
    return data;
}

/// @desc Input for a keyboard key
/// @param {real} button
function InputButtonKeyboard(button) : AbstractInputButton(button, eInputType.keyboard) constructor {
    // Keyboard input handling goes here
}

var kbInput = new InputButtonKeyboard();
kbInput.cleanup();
delete kbInput; // delete the struct

global.camera.punch(undefined, undefined, _num_hearts);

array_push(points, {x: mouse_x, y: mouse_y, z: 0, nx: 0, ny: 0, nz: 1});
