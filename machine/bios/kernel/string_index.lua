module<const>

-- Source basis: a7e8a8d532c8d4715736d6efc644834f4c16cc09.
-- T: cpu.ts; C: cpu.cpp. The existing root words now own this binding.
local layout<const> = require('kernel/gc_runtime_layout')
local table_tag<const> = 6 -- T:4535 C:1264; ValueTag.Table
local invalid_argument<const> = 10 -- T:4536 C:1265; LuaFaultReason

local install<const> = function(index) -- T:4534-4539 C:1263-1268
	local management<const>: *u32 = layout.management_address
	local base<const> = layout.ram_base + *management
	local address<const> = base + layout.value_cell_offset
	local cell<const>: *value = address
	local word<const>: *u32 = address
	local tag<const>: *u8 = address + layout.value_cell_tag_offset
	local head<const>: *root_head_input = base + layout.remark_head_offset
	*cell = index -- T:4535,4538 C:1264,1267
	if *tag ~= table_tag then -- T:4535 C:1264
		local fault<const>: *u32 = layout.call_fault_address
		*fault = invalid_argument -- T:4536 C:1265
		return
	end
	head.string_index_tag = table_tag -- T:5317 C:3225
	head.string_index_word = *word -- T:5318 C:3226
end

return { install = install }
