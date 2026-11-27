module<const>

local records<const> = require('kernel/allocate_record')
local layout<const> = require('kernel/gc_runtime_layout')

local integer_tag<const> = 3
local table_tag<const> = 6
local table_record_kind<const> = 0
local hint_mask<const> = 0xffff8000
local invalid_argument<const> = 10
local out_of_memory<const> = 9

local create_table<const> = function(array, hash)
	local management_port<const>: *u32 = layout.management_address
	local source_cycles_port<const>: *u32 = layout.call_cycles_address
	local run_kind_port<const>: *u32 = layout.call_run_kind_address
	local fault_port<const>: *u32 = layout.call_fault_address
	local management<const> = *management_port
	local address<const> = layout.ram_base + management + layout.value_cell_offset
	local value_cell<const>: *value = address
	local payload<const>: *u32 = address
	local tag<const>: *u8 = address + layout.value_cell_tag_offset

	*value_cell = array
	local array_tag<const>, array_size<const> = *tag, *payload
	*value_cell = hash
	local hash_tag<const>, hash_size<const> = *tag, *payload
	if array_tag ~= integer_tag or hash_tag ~= integer_tag or ((array_size | hash_size) & hint_mask) ~= 0 then
		*fault_port = invalid_argument
		return nil
	end
	local offset<const> = records.allocate_record(management, table_record_kind, array_size, hash_size,
		*run_kind_port, *source_cycles_port)
	if offset == 0 then
		*fault_port = out_of_memory
		return nil
	end
	*payload = layout.ram_base + offset
	*tag = table_tag
	return *value_cell
end

return { create_table = create_table }
