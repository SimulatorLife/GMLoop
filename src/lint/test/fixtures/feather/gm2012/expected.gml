// If a vertex format is malformed, then it does nothing and should be removed
vertex_format_end();
vertex_format_begin();
vertex_format_add_position_3d();
vertex_format_begin();
vertex_format_add_texcoord();
format = vertex_format_end();

// If a vertex format is ended and empty but not assigned, then it does nothing and should be removed
vertex_format_begin();
vertex_format_end();

// If a vertex format might be built within a function call, then it should be kept
vertex_format_begin();

scr_custom_function();

format2 = vertex_format_end();

// If a vertex format might be started within a custom function call, then it should be kept
scr_custom_function2();
vertex_format_add_texcoord();
format3 = vertex_format_end();