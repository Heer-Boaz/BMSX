module<const>

-- Source basis: e3774a03a44e94be4d9d8be73c7ce2de80a336c2. T/C are the
-- former TS/C++ CPU builtins. The linked public wrapper has already
-- normalized both bounds; copying and interning now costs guest instructions.
local layout<const> = require('kernel/gc_runtime_layout')
local strings<const> = require('kernel/allocate_string_slice')
local string_tag<const> = 5
local invalid_argument<const> = 10
local out_of_memory<const> = 9

local intern_slice<const> = function(source, first, last, system, cart0, cart1)
	local management_port<const>: *u32 = layout.management_address
	local cycles_port<const>: *u32 = layout.call_cycles_address
	local fault_port<const>: *u32 = layout.call_fault_address
	local management<const> = *management_port
	local address<const> = layout.ram_base + management + layout.value_cell_offset
	local cell<const>: *value = address
	local payload<const>: *u32 = address
	local tag<const>: *u8 = address + layout.value_cell_tag_offset
	*cell = source -- T:4524-4528 C:1254-1258; tagged CALL argument
	if *tag ~= string_tag then -- T:4525-4526 C:1255,1258
		*fault_port = invalid_argument
		return nil
	end
	local id<const>, fault<const> = strings.intern_slice(management, *payload, first - 1, last - first + 1, *cycles_port, system, cart0, cart1) -- T:4528,4533-4535 C:1259-1261
	if fault ~= 0 then
		*fault_port = invalid_argument
		return nil
	end
	if id == 0 then
		*fault_port = out_of_memory
		return nil
	end
	*payload = id
	*tag = string_tag
	return *cell -- T:4535 C:1261; tagged RET result
end

return { intern_slice = intern_slice }
