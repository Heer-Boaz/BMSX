module<const>

-- Management word addresses in the pinned system context, relative to the
-- management reservation. The CPU publishes data here; it does not select
-- collector phases. The effect address is a private store strobe, not RAM.
return {
	ram_base = 0x08000000,
	metadata_offset = 0x300,
	control_offset = 0x344,
	occupied_offset = 0x3f0,
	arena_offset = 0x400,
	root_banks_offset = 0x600,
	remark_head_offset = 0x680,
	object_context_offset = 0x700,
	trace_context_offset = 0x740,
	effect_offset = 0x788,
	arguments_offset = 0x790,
	publish_roots = 0,
	release_string_work = 5,
}
