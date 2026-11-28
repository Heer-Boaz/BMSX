module<const>

-- Physical BIOS workspace; offsets are relative to its RAM reservation.
return {
	firmware_data_offset = 0x1c00,
	function_binding_offset = 0x3c80, -- beyond the 1024-entry capture work planes
	canonical_closure_heads_offset = 0x3d00,
	ram_base = 0x08000000,
	management_offset = 0x003fc000,
	interrupted_context_address = 0x083fd8d0,
	table_rebuild_offset = 0x000, -- 64-byte staged job, before String metadata
	table_plan_offset = 0x100, -- 144-byte census, then admitted reservation request
	image_operand_maps_offset = 0x200,
	system_global_bank_offset = 0x230,
	ordinary_global_bank_offset = 0x23c,
	image_operand_backings_offset = 0x250,
	metadata_offset = 0x300,
	control_offset = 0x344,
	occupied_offset = 0x3f0,
	string_mark_work_offset = 0x3f4,
	arena_offset = 0x400,
	root_banks_offset = 0x600,
	remark_head_offset = 0x680,
	remark_new_index_offset = 12,
	remark_parked_assignment_offset = 48,
	remark_receiver_offset = 52,
	trace_context_offset = 0x740,
	trace_string_work_offset = 12,
	value_cell_offset = 0x7a0, -- firmware scratch; only this module owns the placement
	value_cell_tag_offset = 4,
}
