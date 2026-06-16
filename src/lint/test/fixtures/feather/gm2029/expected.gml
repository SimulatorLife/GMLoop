// Draw Event

draw_primitive_begin();
draw_vertex(room_width / 4, room_height / 4);

draw_vertex(room_width / 2, room_height / 4); draw_vertex(room_width / 4, room_height / 2);

draw_primitive_begin(pr_trianglelist);
draw_primitive_end();
draw_primitive_end();

draw_primitive_begin(pr_trianglelist);

draw_primitive_end();