module<const>

local records<const> = require('kernel/allocate_record')
local layout<const> = require('kernel/gc_runtime_layout')

-- The call gate transports each caller Value as an Integer tag/word pair.
-- Only compiler-sized array/hash hints are part of this entry's contract;
-- a cartridge issuing BIOSCALL directly must meet the same constraints.
local integer_tag<const> = 3
local table_tag<const> = 6
local table_record_kind<const> = 0
local hint_mask<const> = 0xffff8000
local invalid_argument<const> = 10
local out_of_memory<const> = 9

local create_table<const> = function(management, source_cycles, run_kind, array_tag, array, hash_tag, hash)
	if array_tag ~= integer_tag or hash_tag ~= integer_tag or ((array | hash) & hint_mask) ~= 0 then
		return invalid_argument + 1, 0, 0
	end
	local offset<const> = records.allocate_record(management, table_record_kind, array, hash, run_kind, source_cycles)
	if offset == 0 then return out_of_memory + 1, 0, 0 end
	return 0, table_tag, layout.ram_base + offset
end

return { create_table = create_table }
