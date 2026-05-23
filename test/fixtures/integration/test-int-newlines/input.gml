/// @description Set zmodel

image_yscale = BILLBOARD_PROP_YSCALE;

// Inherit the parent event
event_inherited();

// Define zmodel
var mat = scr_matrix_build(x, y, z, xrotation, yrotation, image_angle, image_xscale, image_yscale, image_zscale);
zmodel = new ZModelBufferSprite(sprite_index, undefined, mat, image_blend, image_alpha);

/// @desc Spawn a number of enemies if criteria is met
/// @param {real} [num_enemies] How many enemies to try to spawn. If we already have too many enemies, don't spawn them.
/// @returns {undefined}
function try_spawn_enemies(num_enemies = irandom_range(wave_enemy_max * 0.25, wave_enemy_max * 0.34)) {
    var enemy_type = choose(obj_skeleton, obj_crab);
    var current_enemies = instance_number(enemy_type);
    var can_spawn = wave_enemy_max - current_enemies;
    var to_spawn = min(num_enemies, can_spawn);
    repeat (to_spawn) {
        instance_create_layer(irandom(room_width), irandom(room_height), "instances", enemy_type);
    }
}
