// Draw regular particles
if (part_type != prev_part_type) {
	shader = (/*emitterMesh ? emitter_mesh_shader : */ (part_type.mesh_enabled ? mesh_shader : regular_shader));
	if (shader < 0){ continue; } // Shader does not exist, can't draw this emitter
	shader_set(shader);
	uni_ind = global.spart_controller.get_uniform_index(shader);
	part_type.set_uniforms(uni_ind);
	prev_part_type = part_type;
}