module<const>

-- Firmware operands to the ordinary System vector. They are not ISA fields.
return {
	string_from_bytes = 0x10000,
	collect_full = 0x10001,
	collect_step = 0x10002,
	heap_count = 0x10003,
	heap_capacity = 0x10004,
	admit_floor = 0x10005,
	bind_cartridge = 0x10006,
	reserve_entry = 0x10007,
	string_slice = 0x10008,
	string_chars = 0x10009,
	string_concat = 1,
	string_index = 0x1000a,
	create_table = 0,
}
