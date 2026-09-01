// Setup complete
var ready = true;

// Draw Triangle
var top = [room_width / 2, 0];
var left = [0, room_height];
var right = [room_width, room_height];

draw_vertex(top[0], top[1]);
draw_vertex(left[0], left[1]);
draw_vertex(right[0], right[1]);

draw_primitive_begin(pr_trianglelist);
draw_primitive_end();
