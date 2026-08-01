lst_instances = ds_list_create();

if (instance_place_list(x, y, obj_enemy, lst_instances, true))
{
    var _ins = lst_instances[? 0];
    show_debug_message(string(_ins));
}

var my_map = ds_map_create();
var value = my_map[| "key"];
var cell = level_grid[| 1, 2];
var cellAlt = myGrid[? 1, 2];
var passthrough = some_var[? 0];
var item = inventory[$ "potion"];
var itemAlt = map_items[| 0];
