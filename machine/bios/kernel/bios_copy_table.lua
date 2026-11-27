module<const>

-- Source basis: 8cf6e61b2b8207a31ae7be9c7acb095910ff2793.
-- C/T: native invocation; L/A: LuaHeap; W: existing intrinsic tagged Value exchange.
-- C:1228 T:4435; the old byte/slot charge is replaced by paid BLua instructions.
local layout<const> = require('kernel/gc_runtime_layout') -- C:1225,1229 T:4430,4436; typed resident CALL/RET transport
local records<const> = require('kernel/allocate_record') -- C:1227 T:4434
local table_tag<const> = 6 -- C:1226 T:4431
local invalid_argument<const> = 10 -- C:1226 T:4432
local out_of_memory<const> = 9 -- L:152-154 A:153-155; original allocation refusal.

local copy_table<const> = function(source) -- C:1224-1231 T:4429-4438
	local management_port<const>: *u32 = layout.management_address -- C:1225,1229 T:4430,4436; typed resident CALL/RET transport
	local cycles_port<const>: *u32 = layout.call_cycles_address -- C:1225,1229 T:4430,4436; typed resident CALL/RET transport
	local fault_port<const>: *u32 = layout.call_fault_address -- C:1225,1229 T:4430,4436; typed resident CALL/RET transport
	local management<const> = *management_port -- C:1225,1229 T:4430,4436; typed resident CALL/RET transport
	local address<const> = layout.ram_base + management + layout.value_cell_offset -- C:1225,1229 T:4430,4436; typed resident CALL/RET transport
	local value<const>: *value = address -- C:1225,1229 T:4430,4436; typed resident CALL/RET transport
	local payload<const>: *u32 = address -- C:1225,1229 T:4430,4436; typed resident CALL/RET transport
	local tag<const>: *u8 = address + layout.value_cell_tag_offset -- C:1225,1229 T:4430,4436; typed resident CALL/RET transport
	*value = source -- C:1225 T:4431
	if *tag ~= table_tag then -- C:1226 T:4431
		*fault_port = invalid_argument -- C:1226 T:4432
		return nil -- C:1226 T:4432; caller receives fault, not a partial result
	end
	local offset<const> = records.allocate_record(management, records.table_copy_kind, *payload, 0, records.direct_mode, *cycles_port) -- C:1227 T:4434
	if offset == 0 then -- L:152-154 A:153-155; native allocation refusal
		*fault_port = out_of_memory -- L:152-154 A:153-155; before publishing any result
		return nil -- L:152-154 A:153-155; bounded fault return, no result published
	end
	*payload = layout.ram_base + offset -- C:1229 T:4436
	*tag = table_tag -- C:1229 T:4436
	return *value -- C:1229 T:4436
end

return { copy_table = copy_table }
