module<const>

struct geo_manual_sources
	src0: word
	src1: word
	src2: word
	dst0: word
	dst1: word
	count: word
end

struct geo_manual_parameters
	param0: word
	param1: word
	stride0: word
	stride1: word
	stride2: word
end

struct geo_manual_vertex
	x: word
	y: word
end

struct geo_manual_transform
	m00: word
	m01: word
	tx: word
	m10: word
	m11: word
	ty: word
end

struct geo_manual_xform_record
	flags: word
	source_index: word
	destination_index: word
	matrix_index: word
	vertex_count: word
	bounds_index: word
end

struct geo_manual_sat_pair
	flags: word
	shape_a: word
	result_index: word
	shape_b: word
	flags2: word
end

struct geo_manual_sat_shape
	flags: word
	vertex_count: word
	vertex_offset: word
	reserved: word
end

struct geo_manual_sat_result
	hit: word
	nx: word
	ny: word
	depth: word
	meta: word
end

struct geo_manual_shape
	kind: word
	data_count: word
	data_offset: word
	bounds_offset: word
	bounds: f32[4]
end

struct geo_manual_instance
	shape: word
	tx: f32
	ty: f32
	layer: word
	mask: word
end

struct geo_manual_candidate
	instance_a: word
	instance_b: word
	meta: word
end

struct geo_manual_contact
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

struct geo_manual_summary
	result_count: word
	exact_pairs: word
	broadphase_pairs: word
	flags: word
end

struct geo_manual_observation
	status: word
	processed: word
	fault: word
end

struct geo_manual_result
	completed_phase: word
	service_sequence: word
	done_count: word
	error_count: word
	vertices: geo_manual_vertex[8]
	bounds: word[8]
	sat: geo_manual_sat_result
	shape: geo_manual_shape
	instances: geo_manual_instance[2]
	contacts: geo_manual_contact[2]
	summaries: geo_manual_summary[2]
	observations: geo_manual_observation[6]
	acknowledged_status: word
	acknowledged_fault: word
	final_irq_flags: word
end

bss result: geo_manual_result

return { result = result }
