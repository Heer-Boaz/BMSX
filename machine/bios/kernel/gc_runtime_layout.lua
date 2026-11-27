module<const>

-- Pinned System context: relative management offsets and CPU-private ports.
-- The CPU makes data available without selecting collector phases. The
-- effect address is a private store strobe, not RAM.
return {
	ram_base = 0x08000000,
	table_rebuild_offset = 0x000, -- 64-byte staged job, before String metadata
	metadata_offset = 0x300,
	control_offset = 0x344,
	occupied_offset = 0x3f0,
	string_mark_work_offset = 0x3f4,
	arena_offset = 0x400,
	root_banks_offset = 0x600,
	remark_head_offset = 0x680,
	remark_new_index_offset = 12,
	object_context_offset = 0x700,
	trace_context_offset = 0x740,
	effect_offset = 0x788,
	arguments_offset = 0x790,
	remaining_device_cycles_address = 0x02c00000,
	publish_roots = 0,
	release_string_work = 5,
}
