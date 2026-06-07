some(
    thisArgumentIsQuiteLong,
    function foo(cool, f = function () { ez(); }) : bar() constructor {
        self.cool = cool;
        self.f = f;
    }
);

call(1, 2, 3, someFunctionCallWithBigArgumentsAndACallback, function (aaaaaaaaaaaaaaaaaa) {
    foo();
});

var myBar;
try {
    myBar = new bar();
} catch (e) {
    show_debug_message($"Caught exception: {e}");
} finally {
    myBar = undefined;
}

my_func();
my_func(undefined);
my_func2(1, undefined);
my_func3(3, undefined, undefined, undefined, undefined, 5);
my_func4(undefined);

/// @param [x=0]
/// @param [y=0]
/// @param [z=0]
/// @returns {array}
function func_coords(x = 0, y = 0, z = 0) {
    return [x, y, z];
}

var myCoords = func_coords(10, undefined, 20);

/// @ignore
/// @desc Base class for all shapes. Shapes can be solid or not solid.
///       Solid shapes will collide with other solid shapes, and
///       non-solid shapes will not collide with anything.
/// @param [color]
function Shape(color = undefined) constructor {
    self.color = color;

    /// @returns {undefined}
    static print = function () {
        show_debug_message("I'm a shape");
    };

    /// @desc This will delete any geometry info contained within the mesh itself.
    ///       It will not delete any geometry added to a ColMesh.
    ///       After a mesh has been frozen, it can no longer be added to a colmesh.
    /// @returns {undefined}
    static freeze = function () {
        triangles = [];
        ds_list_destroy(shapeList);
    };

    /// @param {bool} solid Whether the shape is solid or not
    /// @returns {undefined}
    static setSolid = function (solid) {
        if (solid) {
            group |= cmGroupSolid; // Flag as solid
        } else {
            group &= ~cmGroupSolid; // Remove solid flag
        }
    };
}
/// @param {real} r -  The radius of the circle
/// @param r
/// @returns {undefined}
function Circle(r) : Shape() constructor {
    self.r = r;
}

var myCircle = new Circle(10);
var circle2 = new Circle(myCircle.r);

show_debug_message(myCircle.r);
/// @param {real} r1 - The horizontal radius of the oval
/// @param [r1=1]
/// @param [r2=1]
/// @returns {undefined}
function Oval(r1 = 1, r2 = 1) : Shape() constructor {
    self.r1 = r1;
    self.r2 = r2;
}
/// @returns {undefined}
function Line() : Shape() constructor {

    /// @param x1
    /// @param y1
    /// @param x2
    /// @param y2
    /// @returns {undefined}
    set_points = function (x1, y1, x2, y2) {
        self.x1 = x1;
        self.y1 = y1;
        self.x2 = x2;
        self.y2 = y2;
    };
}

/// @param settings
/// @param fallback
function choose_profile(settings, fallback) {
    var config = settings ?? global.default_settings;
    var themeCandidate = config.theme_override ?? fallback.theme_override;
    var finalTheme = themeCandidate ?? global.theme_defaults;
    if ((config ?? fallback) == undefined) {
        return "guest";
    }
    return config.profile ?? (fallback.profile ?? "guest");
}

var best = choose_profile(undefined, {profile: "dev"});

// Feather disable all
// .__Destroy()
// .__FromBuffer(buffer)
// .__CopyFromBuffer(buffer)
// .__FromString(string, )
// .__Delete(position, count)
// .__Insert(position, string, )
// .__Overwrite(position, string, )
// .__Prefix(string, )
// .__Suffix(string, )
// .__GetString()
// .__GetBuffer()

function __ChatterboxBufferBatch() constructor {
    __destroyed = false;
    __inBuffer = undefined;
    __workBuffer = undefined;
    __outBuffer = undefined;
    __commands = [];

    /// @returns {undefined}
    static __Destroy = function () {
        if (__destroyed) {
            return;
        }
        __destroyed = true;

        if (__inBuffer != undefined) {
            buffer_delete(__inBuffer);
            __inBuffer = undefined;
        }

        if (__inBuffer == undefined) {
            __destroyed = true;
        }
    };
}

/// @param [name="friend"]
/// @param [greeting="Hello"]
/// @returns {string}
function greet(name = "friend", greeting = "Hello") {
    return $"{greeting}, ${name}";
}

var message1 = greet();
var message2 = greet("Alice");
var message3 = greet("Bob", "Howdy");
var message4 = greet("Chaz");
var message5 = greet(undefined, "Welcome");

/// @param {real} [multiplier=1] The multiplier to apply to the light direction
/// @param {array<real>} [light_dir=[0, 0, -1]] The direction of the light
/// @returns {array<real>}
function handle_lighting(multiplier = 1, light_dir = [0, 0, -1]) {
    var dir = light_dir;
    var length = point_distance_3d(0, 0, 0, dir[0], dir[1], dir[2]);
    length *= multiplier;
    if (abs(length) > math_get_epsilon()) {
        dir[0] /= length;
        dir[1] /= length;
        dir[2] /= length;
    }
    return dir;
}

/// @param {Id.Instance} a
/// @param {Id.Instance} b
/// @param {real} dst
/// @param {real} force
/// @param {bool} [push_out=true]
/// @param {bool} [pull_in=true]
/// @returns {bool}
function scr_spring(a, b, dst, force, push_out = true, pull_in = true) {
    if (!instance_exists(a) or !instance_exists(b)) {
        return false;
    }

    var xoff = a.x - b.x;
    var yoff = a.y - b.y;

    var actual_dist = sqr(xoff) + sqr(yoff);
    if (abs(actual_dist) < math_get_epsilon()) {
        return false;
    }
    if (((actual_dist < sqr(dst)) and push_out) or ((actual_dist > sqr(dst)) and pull_in)){
        actual_dist = sqrt(actual_dist);
        var diff = actual_dist - dst;

        // normalize and multiply with diff and amount
        var norm = (force * diff) / actual_dist;
        xoff *= norm;
        yoff *= norm;

        // calculate mass
        var m1, r1, r2;
        m1 = 1 / (b.mass + a.mass);
        r1 = b.mass * m1 * 0.5;
        r2 = a.mass * m1 * 0.5;

        // add speeds
        a.velocity.x -= xoff * r1;
        a.velocity.y -= yoff * r1;
        b.velocity.x += xoff * r2;
        b.velocity.y += yoff * r2;

        return true;
    }

    return false;
}

get_debug_text = function () {
    var txt = "";

    txt += $"\nPosition: {new Vector3(x, y, z).to_string(true)}";
    txt += $"\nLand type: {global.island.get_land_string(land_type)}";
    txt += $"\nDirection: {round(direction)}";

    if (!is_undefined(weapon)) {
        txt += weapon.get_debug_text();
    }

    txt += hp.get_debug_text();
    txt += states.get_debug_text();
    txt += mover.get_debug_text();
    txt += arm_r.get_debug_text();
    return txt;
};

/// @description Write a unit triangular prism into an existing vbuff.
///              Local space: X∈[-0.5,+0.5], Y∈[-0.5,+0.5], base plane at Z=0, apex line at (Y=0,Z=1).
/// @param vbuff
/// @param [colour=c_white]
/// @param [alpha=1]
/// @param trans_mat
/// @returns {undefined}
function vertex_buffer_write_triangular_prism(vbuff, colour = c_white, alpha = 1, trans_mat) {
    var hx = 0.5, hy = 0.5, h = 1;

    // Base corners (Z = 0)
    var L0 = [-hx, -hy, 0]; // x-, y-
    var L1 = [-hx, hy, 0]; // x-, y+
    var R0 = [hx, -hy, 0]; // x+, y-
    var R1 = [hx, hy, 0]; // x+, y+

    // Apex line (Y=0, Z=1)
    var LA = [-hx, 0, h];
    var RA = [hx, 0, h];

    // Reusable UVs
    static uv00 = [0, 0];
    static uv10 = [1, 0];
    static uv11 = [1, 1];
    static uv01 = [0, 1];

    // Base quad (Z=0): L0-R0-R1, L0-R1-L1 (outside normal points to Z-; ok for debug)
    vertex_buffer_write_triangle(
        vbuff,
        L0,
        R0,
        R1,
        uv00,
        uv10,
        uv11,
        colour,
        alpha,
        trans_mat
    );
    vertex_buffer_write_triangle(
        vbuff,
        L0,
        R1,
        L1,
        uv00,
        uv11,
        uv01,
        colour,
        alpha,
        trans_mat
    );

    // Left sloped face (y=-hy -> apex): quad L0-R0-RA-LA => (L0,R0,RA) + (L0,RA,LA)
    vertex_buffer_write_triangle(
        vbuff,
        L0,
        R0,
        RA,
        uv00,
        uv10,
        uv11,
        colour,
        alpha,
        trans_mat
    );
    vertex_buffer_write_triangle(
        vbuff,
        L0,
        RA,
        LA,
        uv00,
        uv11,
        uv01,
        colour,
        alpha,
        trans_mat
    );

    // Right sloped face (y=+hy -> apex): quad R1-L1-LA-RA => (R1,L1,LA) + (R1,LA,RA)
    vertex_buffer_write_triangle(
        vbuff,
        R1,
        L1,
        LA,
        uv00,
        uv10,
        uv11,
        colour,
        alpha,
        trans_mat
    );
    vertex_buffer_write_triangle(
        vbuff,
        R1,
        LA,
        RA,
        uv00,
        uv11,
        uv01,
        colour,
        alpha,
        trans_mat
    );

    // End caps (triangles in X)
    // X = -hx cap: L0, L1, LA
    vertex_buffer_write_triangle(
        vbuff,
        L0,
        L1,
        LA,
        uv00,
        uv10,
        uv11,
        colour,
        alpha,
        trans_mat
    );
    // X = +hx cap: R1, R0, RA
    vertex_buffer_write_triangle(
        vbuff,
        R1,
        R0,
        RA,
        uv00,
        uv10,
        uv11,
        colour,
        alpha,
        trans_mat
    );
}
