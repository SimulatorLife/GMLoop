/// @description Initialize sound controller

/// @function set_master_volume(new_volume)
/// @description Set the gain for the master volume from the volume specified in the settings
/// @returns {undefined}
function set_master_volume() {
    var i = 0;
    repeat (audio_get_listener_count()) {
        var info = audio_get_listener_info(i++);
        audio_set_master_gain(info[? "index"], global.settings.master_volume);
        ds_map_destroy(info);
    }
}
