module<const>

local records<const> = require('kernel/allocate_record')
local layout<const> = require('kernel/gc_runtime_layout')

local hint_mask<const> = 0xffff8000
local table_record_kind<const> = 0
local invalid_argument<const> = 10
local out_of_memory<const> = 9

local create_table<const> = function(array_size, hash_size)
	if ((array_size | hash_size) & hint_mask) ~= 0 then return nil, invalid_argument end
	local offset<const> = records.allocate_record(layout.management_offset, table_record_kind, array_size, hash_size,
		0, cop0.event_cycles)
	if offset == 0 then return nil, out_of_memory end
	return layout.ram_base + offset, nil
end

return { create_table = create_table }
