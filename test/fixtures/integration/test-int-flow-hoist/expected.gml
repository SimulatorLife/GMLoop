//subMesh.addShape(new colmesh_block(matrix_build(0, 0, 0, 0, 0, 0, 300, 300, 40)));
subMesh.addShape(new colmesh_disk(0, 0, 0, 0, 0, 1, 300, 50));

if (headerText != "ColMesh v4") {
    return false;
}

switch (cannonball_type) {
    case obj_cannonball_beachball:
        sprite_index = spr_cannonball_beachball;
        break;
    case obj_cannonball_bomb:
        sprite_index = spr_cannonball_bomb;
        break;
    default:
        sprite_index = noone;
        break;
}

var matrix = scr_matrix_build(
    x, y,
    z + zfight,
    xrotation,
    yrotation,
    image_angle,
    image_xscale,
    image_yscale,
    image_zscale
);

var matrix2 = scr_matrix_build(
    x, y,
    z + zfight,
    xrotation,
    yrotation,
    image_angle,
    image_xscale,
    image_yscale,
    image_zscale + 90
);

var total = 0;
var limit = 99;
var arr = global.some_array;
var value = 0;
var tracker = {data: arr, lastIndex: -1};

do {
    value += 1;
    if (value > limit) {
        throw "Exceeded";
    }
} until (value >= limit);

var len = array_length(arr);
for (var i = 0; i < len; i++) {
    var current = arr[i];
    if (current < 0) {
        continue;
    }
    if (current > limit) {
        throw "Too big";
    }
    tracker.lastIndex = i;
    total += current;
}

var arr2 = [1, 2, 3, 4, 5];

var i = 0;
repeat (array_length(arr2)) {
    show_debug_message(arr2[i++]);
}

do {
    value = INCREMENT(value);
    if (value == SQUARE(limit)) {
        value = sqr(limit);
        throw "Square limit";
    }
} until (value > limit * limit);

return total;

/// @param condition
/// @returns {any}
function bool_passthrough(condition) {
    return condition;
}

/// @param {boolean} a The first boolean
/// @param {boolean} b The second boolean
/// @returns {any}
function bool_negated(a, b) {
    return !a or !b;
}

/// @param condition
/// @returns {any}
function bool_with_comment(condition) {
    if (condition) {
        // comment should stop simplification
        return true;
    } else {
        return false;
    }
}

/// @param list
/// @param map
/// @param grid
/// @returns {undefined}
function iterate_structures(list, map, grid) {
    for (var i = 0; i < ds_list_size(list); i++) {
        show_debug_message(list[| i]);
    }

    for (var key = 0; key <= ds_map_size(map); key += 1) {
        show_debug_message(ds_map_find_value(map, key));
    }

    for (var x = 0; x < ds_grid_width(grid); x++) {
        for (var y = 0; y < ds_grid_height(grid); y++) {
            show_debug_message(grid[# x, y]);
        }
    }

    for (var unsafe = 0; unsafe < ds_list_size(list); other++) {
        show_debug_message(unsafe);
    }
}

switch (value) {
    case 1:
    case 2:
        show_debug_message("two");
        break;
    default:
        break;
}
