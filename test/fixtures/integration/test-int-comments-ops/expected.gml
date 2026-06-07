// Set foot movement speed according to character rotation and movement speeds (this is so the legs don't end up trailing when the character is moving too fast)
//try { // TODO this sometimes throws NaN error, try catch is band-aid
//	foot_spd = min(0.5 * sqrt(sqr(x - xprevious) + sqr(y - yprevious)) + abs(last_crab_dir) * 0.1 + 0.2, 1);
//} catch(ex) {
//	show_debug_message("Caught exception while trying to update crab foot speed: " + string(ex));
//}

// Make body wobble up and down // This is a trailing comment
z_wobble = (sin(current_time * 0.004) + 1) * 2 + 2; // value between 0 and 2, this is subtracted from crabs height

/// @desc Emulation of string_height(), but using Scribble for calculating the width
///       **Please do not use this function in conjunction with string_copy()**
/// @param string The string to draw
function string_height_scribble(_string) {
    static _scribble_state = __scribble_get_state();

    var _font = draw_get_font();
    _font = !font_exists(_font) ? _scribble_state.__default_font : font_get_name(_font);

    return scribble(_string).starting_format(_font, c_white).get_height();
}

// This is an unrelated comment

/// @desc Tests to see if a font has the given character
/// @param font_name The target font, as a string
/// @param character Character to test for, as a string
/// @returns {bool} Indicating whether the given character is found in the font
function scribble_font_has_character(_font_name, _character) {
    return ds_map_exists(__scribble_get_font_data(_font_name).__glyphs_map, ord(_character));
}

/// @param x1
/// @param y1
/// @param z1
/// @param x2dir
/// @param y2dir
/// @param z2dir
/// @param x3
/// @param y3
/// @param z3
/// @param length1
/// @param length2
/// @returns {array}
function twojointik(x1, y1, z1, x2dir, y2dir, z2dir, x3, y3, z3, length1, length2) {
    /// @description twojointik(x1, y1, z1, x2dir, y2dir, z2dir, x3, y3, z3, length1, length2)
    /*
        This function calculates the position of a two jointed IK chain.
        It returns an array with the position of the joint and the end effector.
        x1, y1, z1 : The position of the root of the chain
        x2dir, y2dir, z2dir : The direction the first joint should face
        x3, y3, z3 : The target position of the end effector
        length1 : The length of the first bone
        length2 : The length of the second bone
        unrelated : comment to test
        unrelated2 another comment to test
    */
    /* Return an array */
    return [x2, y2, z2, x3, y3, z3];
}

alarm[1] = 10; // not everything loaded yet, check again in a bit

#region Collision

// Create colmesh shape & mark as trigger - now collision functions can be executed
colmesh_shape = new ColmeshBlock(scr_matrix_build(round(x), round(y), round(z - 2), 0, 0, 0, max(ceil(sprite_width * 0.5), 10), 4, max(32, sprite_height + 2)));
global.room_colmesh.add_shape(colmesh_shape, true, false, true, false, undefined, function (o) { // need a function for trigger so projectiles can collide with this, passthrough and call projectile's function
    gml_pragma("forceinline");
    try {
        o.collider.trigger_shape.col_func(id);
    } catch (e) {}
}); // Add to room's colmesh - now that unburied, can collide with stuff

#endregion

if (
    (_last_byte == 33) || // !=
    (_last_byte == 42) || // *=
    _last_byte == 43 || // +=
    _last_byte == 45 || // +=
    _last_byte == 47 || /// =
    _last_byte == 60 || // <=
    _last_byte == 61 || // ==
    _last_byte == 62 // >=
) {
    show_debug_message("Yay");
}
