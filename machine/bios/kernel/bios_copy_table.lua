module<const>

-- Source basis: 8cf6e61b2b8207a31ae7be9c7acb095910ff2793.
-- C/T: native invocation; L/A: LuaHeap.
-- C:1228 T:4435; the old byte/slot charge is replaced by paid BLua instructions.
local layout<const> = require('kernel/gc_runtime_layout')
local records<const> = require('kernel/allocate_record') -- C:1227 T:4434
local table_tag<const> = 6 -- C:1226 T:4431
local invalid_argument<const> = 10 -- C:1226 T:4432
local out_of_memory<const> = 9 -- L:152-154 A:153-155; original allocation refusal.

local copy_record<const> = function(source, tag) -- C:1224-1225 T:4429-4430; original register planes, not a scratch Value
	if tag ~= table_tag then return nil, invalid_argument end -- C:1226 T:4431-4433
	local offset<const> = records.allocate_record(layout.management_offset, records.table_copy_kind, source, 0, records.direct_mode, cop0.event_cycles) -- C:1227 T:4434
	if offset == 0 then return nil, out_of_memory end -- L:152-154 A:153-155; no partial result
	return layout.ram_base + offset, nil -- C:1229 T:4436
end

return { copy_record = copy_record }
