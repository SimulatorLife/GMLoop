/// @description States and drawing code examples to be preserved

// Whether chatterboxes should default to singleton mode. This is useful to most RPGs where lines
// of dialogue arrive one at a time. More modern narrative games tend to deliver larger chunks of

var my_val = (2 + 3) * 4;
var b = x > y ? a + b : a - b;

// Define states
states.add_state(
    "opening",
    function () { // enter
        gml_pragma("forceinline");

        var l_jsDummy = l_isJS ? function () {} : undefined;
        scr_play_sound_at(snd_slot_machine, x, y, z);
        scaler.big_squish();
        image_speed = 1; // start animation

        // Start spraying coins
        time_source_start(ts_spray_coins);

        // Start checking if we should destroy the open chest
        call_later(
            1800,
            time_source_units_frames,
            function () {
                gml_pragma("forceinline");
                if (!(global.camera.is_in_view(x, y, z))) {
                    instance_destroy();
                }
            },
            true
        );
    },
    undefined, // step
    function () { // leave
        audio_stop_sound(snd_slot_machine); // stop sound effect
        pe_general.retire(true); // stop sparkle particles
        time_source_stop(ts_spray_coins); // stop this time source
    }
);

//global.rain_controller.draw();
//if (room == rm_island) {
//	global.spart_controller.draw();
//}
//global.part_controller.draw();

var x_body = x + lengthdir_x(radius, angle) - lengthdir_x(radius, aa);
var y_body = y + lengthdir_y(radius, angle) - lengthdir_y(radius, aa);

if (x_body <= 0 || y_body <= 0 || x <= 0 || y <= 0) {
    return []; // Return an empty array for invalid input
}

matrix_set(matrix_world, matrix);
shader_set(shd_flag);
shader_set_uniform_f(u_time, time);
shader_set_uniform_f(u_uvs, uvs.x, uvs.y, uvs.z, uvs.w);
shader_set_uniform_f(u_precalculated_0, precalculated_0.x, precalculated_0.y, precalculated_0.z, precalculated_0.w);
shader_set_uniform_f(u_precalculated_1, precalculated_1.x, precalculated_1.y, precalculated_1.z, precalculated_1.w);
shader_set_uniform_f(u_precalculated_2, precalculated_2);
vertex_submit(vertex_buffer, pr_trianglelist, texture);
shader_reset();
scr_matrix_reset();

global.settings = {
    master_volume: scr_ini_read_real("settings", "master_volume", 0.5, 0, 1),
    music_volume: scr_ini_read_real("settings", "music_volume", 0.6, 0, 1),
    sound_volume: scr_ini_read_real("settings", "sound_volume", 1, 0, 1),
    zoom_level: scr_ini_read_real("settings", "zoom", 3, 0, 1),
    show_hud: scr_ini_read_real("settings", "hud", 1, 0, 1),
    nice_graphics: scr_ini_read_real("settings", "nice_graphics", 1, 0, 1),
    wavy_menu: scr_ini_read_real("settings", "wavy_menu", 1, 0, 1),
    screen_shake: scr_ini_read_real("settings", "screen_shake", 1, 0, 1),
    //gui_scale: ini_read_real("settings", "gui_scale", 1),
    fullscreen: scr_ini_read_real("settings", "fullscreen", window_get_fullscreen(), 0, 1)
};

//if (!variable_instance_exists(id, "pt_colour")) {
//	pt_colour = choose(
//	    eParticleType.fire_red,
//	    eParticleType.fire_blue,
//	    eParticleType.fire_green,
//	    eParticleType.fire_orange,
//	    eParticleType.fire_gold
//	); // choose fire colour
//}

// The following line should be preserved; math-expression parentheses should not be applied to string concatenation
var item_txt = (item_id.name + "\n" + item_id.description + "\n$" + string(item_id.price));

// The following math expressions should be preserved; parentheses make no difference to order of operations
var calc = 3 + 4 + 5;
var calc2 = 3 - 4 + 5;
var calc3 = 3 * 7 * 4 * 5;

// The following line should be preserved; the local variable and instance variable are different scopes and do NOT conflict
var val = 100;
with (instance_create_layer(x, y, "Instances", obj_Fire)) {
    self.val = val;
}

// The following line should be preserved; numbers with leading zeros are allowed in GML
global.lighting.add_key_time(00, 253, 094, 083, 0.5); // Sunset peak at 00h
global.lighting.draw(
    vmat, pmat,
    function () { // Depth drawing callback
        global.renderer.draw_depth();
    },
    function () { // Geometry drawing callback
        global.renderer.draw_geometry();
        global.spart_controller.draw();

        // Debug-drawing
        if (!RELEASE) {
            with (obj_debug) {
                debug_draw();
            }
        }
    }
);

// Set foot movement speed according to character rotation and movement speeds (this is so the legs don't end up trailing when the character is moving too fast)
//try { // TODO this sometimes throws NaN error, try catch is band-aid
//	// foot_spd = min(0.5 * sqrt(sqr(x - xprevious) + sqr(y - yprevious)) + abs(last_crab_dir) * 0.1 + 0.2, 1);
//} catch(ex) {
//	show_debug_message("Caught exception while trying to update crab foot speed: " + string(ex));
//}

// Wobbling in z-axis
// Value between 0 and 2, this is subtracted from crabs height
z_wobble = ((sin(current_time * 0.004) + 1) * 2) + 2;

/// @desc Functions for skyboxes using an octahedron vertex buffer
/// @param {Asset.GMSprite} [sprite=noone]
/// @param {real} [subimg=0]
/// @param {real} [octahedron_scale=1] The scale of the skybox octahedron
/// @param {real} [octmap_size=1024] The size of the octmap
function AbstractSkyboxParent(sprite = noone, subimg = 0, octahedron_scale = 1, octmap_size = 1024) : ZModelBuffer(sprite, subimg, undefined, c_white, 1, pr_trianglelist) constructor {
    self.octahedron_scale = octahedron_scale;
    self.octmap_size = octmap_size;
    self.octmap_texel = 1 / octmap_size;
    self.skyformat = -1;
    self.cullmode = cull_clockwise;

    /// @override
    /// @desc Draw the zmodel
    /// @param {bool} [reset_matrix=true] Reset the world matrix after drawing?
    /// @returns {undefined}
    static draw = function (reset_matrix = true) {

        // Get the current shader
        var prev_shader = shader_current();

        // Set up GPU state
        gpu_push_state();
        gpu_set_texfilter(false);
        gpu_set_texrepeat(true);
        gpu_set_ztestenable(true);
        gpu_set_zwriteenable(false);
        gpu_set_tex_mip_enable(false);
        gpu_set_tex_mip_filter(tf_point);
        gpu_set_cullmode(cullmode);
        gpu_set_blendmode_ext(bm_one, bm_zero);

        // Apply world matrix and submit the vertex buffer
        matrix_set(matrix_world, self.matrix);
        submit();

        // Reset shader, GPU state, and matrix
        gpu_pop_state();
        if (prev_shader != -1) {
            shader_set(prev_shader);
        } else if (shader_current() != -1) {
            shader_reset();
        }
        if (reset_matrix) {
            scr_matrix_reset();
        }
    };

    /// @ignore
    /// @param {Id.Buffer} lbuff
    /// @returns {enum}
    static land_buffer_get_land_type = function (lbuff) {
        var lt = buffer_read(lbuff, buffer_u8);
        switch (lt) { // make sure we get a valid land type
            case eLandType.grass:
            case eLandType.sand:
            case eLandType.sea:
            case eLandType.shallows:
                break;
            default:
                throw "ERROR Island.load_island_data: Invalid land type found";
        }
        return lt;
    };
}

// Debug-only macro guard for *use_fast_sampling* edits
#macro FAST_SAMPLE_GUARD \
    if (use_fast_sampling) {                                                   \
        show_debug_message($"Error in instance: Can't edit fast-sampling instance!");\
        return true;                                                       \
    }

/// @desc Linear blend of *inst_a* <-> *inst_b* into *this* instance
/// @param inst_a
/// @param inst_b
/// @param {real} amount
/// @returns {undefined}
var lerp_sample = function (inst_a, inst_b, amount) {
    FAST_SAMPLE_GUARD
    sample_lerp(inst_a.sample, inst_b.sample, amount, sample);
};

var other_function = function (a, b) {
    return a + b;
};

sprite_top = z + sprite_height; // find the z top of the bomb

/*
// Ensure that commented-out code is preserved as-is
var str = "Move with WASD + space"
    + "\nSwitch demos: 1-5"
    + "\nQ: Unlimit FPS. FPS: " + string(fps) + " / " + string(game_get_speed(gamespeed_fps))
    + "\nE: Draw active colliders"
    + "\nR: Disable drawing"
    + "\nH: Hide text"
    + "\n" + global.demoText;
draw_set_color(c_black);
draw_text(9, 9, str);
draw_text(11, 9, str);
draw_text(9, 11, str);
draw_text(11, 11, str);
draw_set_color(c_white);
draw_set_alpha(1);
draw_text(10, 10, str);
*/

// Feather disable all
/// .__Destroy()
///
/// .__FromBuffer(buffer)
///
/// .__CopyFromBuffer(buffer)
///
/// .__FromString(string, ...)
///
/// .__Delete(position, count)
///
/// .__Insert(position, string, ...)
///
/// .__Overwrite(position, string, ...)
///
/// .__Prefix(string, ...)
///
/// .__Suffix(string, ...)
///
/// .__GetString()
///
/// .__GetBuffer()
