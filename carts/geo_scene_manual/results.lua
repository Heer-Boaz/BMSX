module<const>

struct geo_scene_sources
	src0: word
	src1: word
	src2: word
	dst0: word
	dst1: word
	count: word
end

struct geo_scene_parameters
	param0: word
	param1: word
	stride0: word
	stride1: word
	stride2: word
end

struct geo_scene_vertex
	x: word
	y: word
end

struct geo_scene_float_vertex
	x: f32
	y: f32
end

struct geo_scene_transform
	m00: word
	m01: word
	tx: word
	m10: word
	m11: word
	ty: word
end

struct geo_scene_xform_record
	flags: word
	source_index: word
	destination_index: word
	matrix_index: word
	vertex_count: word
	bounds_index: word
end

struct geo_scene_sat_pair
	flags: word
	shape_a: word
	result_index: word
	shape_b: word
	flags2: word
end

struct geo_scene_sat_shape
	flags: word
	vertex_count: word
	vertex_offset: word
	reserved: word
end

struct geo_scene_sat_result
	hit: word
	nx: word
	ny: word
	depth: word
	meta: word
end

struct geo_scene_polygon
	kind: word
	vertex_count: word
	data_offset: word
	bounds_offset: word
	bounds: f32[4]
	vertices: geo_scene_float_vertex[8]
end

struct geo_scene_instance
	shape: word
	tx: f32
	ty: f32
	layer: word
	mask: word
end

struct geo_scene_candidate
	instance_a: word
	instance_b: word
	meta: word
end

struct geo_scene_contact
	nx: f32
	ny: f32
	depth: f32
	px: f32
	py: f32
	piece_a: word
	piece_b: word
	feature_meta: word
	pair_meta: word
end

struct geo_scene_summary
	result_count: word
	exact_pairs: word
	broadphase_pairs: word
	flags: word
end

struct geo_scene_observation
	status: word
	processed: word
	fault: word
end

struct geo_scene_pose
	transforms: geo_scene_transform[2]
	world: geo_scene_vertex[16]
	bounds: word[8]
	sat: geo_scene_sat_result
	instances: geo_scene_instance[2]
	contact: geo_scene_contact
	summary: geo_scene_summary
	jobs: geo_scene_observation[3]
end

struct geo_scene_result
	prepared_poses: word
	completed_phase: word
	geo_sequence: word
	vblank_sequence: word
	geo_errors: word
	system_origin: word
	system_size: word
	polygon: geo_scene_polygon
	poses: geo_scene_pose[3]
	contact_output: geo_scene_contact
	return_summary: geo_scene_summary
	return_job: geo_scene_observation
	before_vblank: word[6]
	after_vblank: word[6]
	programmed_framebuffer: word[6]
	contact_drawn: word[6]
end

bss result: geo_scene_result
bss sprite_pixels: u16[64][64]

return { result = result, sprite_pixels = sprite_pixels }
