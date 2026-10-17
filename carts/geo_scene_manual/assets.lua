module<const>

-- Explicit indexed artwork: 0 is transparent; 1 is opaque black.
-- One authored pixel occupies one game unit, expanded to 4 x 4 texture texels.
rodata drone_indices: u8[16][16] = {
	{ 0, 0, 0, 0, 4, 4, 4, 4, 4, 4, 4, 4, 0, 0, 0, 0 },
	{ 0, 0, 0, 4, 3, 2, 2, 2, 2, 2, 2, 3, 4, 0, 0, 0 },
	{ 0, 0, 4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 3, 4, 0, 0 },
	{ 0, 4, 3, 2, 2, 2, 3, 3, 3, 3, 2, 2, 2, 3, 4, 0 },
	{ 4, 3, 2, 2, 2, 3, 5, 5, 5, 5, 3, 2, 2, 2, 3, 4 },
	{ 4, 2, 2, 2, 3, 5, 5, 5, 5, 5, 5, 3, 2, 2, 2, 4 },
	{ 4, 2, 2, 2, 3, 5, 5, 1, 1, 5, 5, 3, 2, 2, 2, 4 },
	{ 4, 2, 2, 2, 3, 5, 5, 1, 1, 5, 5, 3, 2, 2, 2, 4 },
	{ 4, 2, 2, 2, 2, 3, 5, 5, 5, 5, 3, 2, 2, 2, 2, 4 },
	{ 4, 2, 2, 2, 2, 2, 3, 3, 3, 3, 2, 2, 2, 2, 2, 4 },
	{ 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 4 },
	{ 4, 3, 2, 2, 5, 5, 2, 2, 2, 2, 5, 5, 2, 2, 3, 4 },
	{ 0, 4, 3, 2, 5, 5, 2, 2, 2, 2, 5, 5, 2, 3, 4, 0 },
	{ 0, 0, 4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 3, 4, 0, 0 },
	{ 0, 0, 0, 4, 3, 2, 2, 2, 2, 2, 2, 3, 4, 0, 0, 0 },
	{ 0, 0, 0, 0, 4, 4, 4, 4, 4, 4, 4, 4, 0, 0, 0, 0 },
}
rodata drone_palette: u16[6] = { 0x0000, 0x8000, 0x294a, 0x4631, 0x6318, 0x7fff }

-- Both sprites share origin (0,0), pivot (8,8), and this authored octagon.
-- These are collision vertices, not a hull generated from the alpha coverage.
rodata local_hull: geo_scene_vertex[8] = {
	{ x = 4 << 16, y = 0 }, { x = 12 << 16, y = 0 },
	{ x = 16 << 16, y = 4 << 16 }, { x = 16 << 16, y = 12 << 16 },
	{ x = 12 << 16, y = 16 << 16 }, { x = 4 << 16, y = 16 << 16 },
	{ x = 0, y = 12 << 16 }, { x = 0, y = 4 << 16 },
}
rodata transform_records: geo_scene_xform_record[2] = {
	{ flags = 0, source_index = 0, destination_index = 0,
		matrix_index = 0, vertex_count = 8, bounds_index = 0 },
	{ flags = 0, source_index = 0, destination_index = 8,
		matrix_index = 1, vertex_count = 8, bounds_index = 1 },
}
rodata sat_pair: geo_scene_sat_pair = {
	flags = 0, shape_a = 0, result_index = 0, shape_b = 1, flags2 = 0,
}
rodata sat_shapes: geo_scene_sat_shape[2] = {
	{ flags = 1, vertex_count = 8, vertex_offset = 0, reserved = 0 },
	{ flags = 1, vertex_count = 8, vertex_offset = 64, reserved = 0 },
}
rodata candidate: geo_scene_candidate = {
	instance_a = 0, instance_b = 1, meta = 0x44524f4e,
}
rodata translations: word[3] = { 20, 16, 12 }

return {
	drone_indices = drone_indices, drone_palette = drone_palette,
	local_hull = local_hull,
	transform_records = transform_records, sat_pair = sat_pair,
	sat_shapes = sat_shapes, candidate = candidate, translations = translations,
}
