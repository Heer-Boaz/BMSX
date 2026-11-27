module<const>

-- Source basis: 8a93a0f474615ca392cf618cc15f7deb4659c1ad.
-- C/T: C++/TS LuaHeap; G/H: C++ GcHeap source/header.
local layout<const> = require('kernel/gc_runtime_layout') -- G:1270,1276
local root_inputs<const> = require('kernel/gc_root_inputs') -- G:1122-1124,1274-1276
local gc<const> = require('kernel/gc_control') -- C:288-289 T:285-286
local collector<const> = require('kernel/gc_step') -- G:1005-1008
local admission<const> = require('kernel/heap_admission') -- C:288-289 T:285-286
local atomic_phase<const> = 3 -- H:20

local collect_step<const> = function() -- C:286-289 T:283-286
	local management<const> = layout.management_offset -- C:286 T:283 G:1270; the BIOS owns this RAM
	local control<const> = management + layout.control_offset -- G:1270
	local phase<const> = gc.internal.phase(control) -- G:1007
	local borrows_roots<const> = phase <= atomic_phase -- G:1122-1124,697-703
	if borrows_roots then root_inputs.publish(management) end -- G:1122-1124,1274-1276; read the stopped context
	if phase == atomic_phase then -- G:1007
		collector.finish_atomic(management, 0, false) -- G:696-702; public Step supplies no scoped roots
	else -- G:1008; the normal step owns one quantum
		collector.step(management, collector.step_words, 0, 0, 0) -- C:287 T:284 G:1005-1008; no compact thread work
	end
	local finished<const> = admission.finish_explicit_step(management + layout.arena_offset) -- C:288-289 T:285-286
	if borrows_roots then collector.finish_operation(management, 0) end -- G:1284,1312-1314; final mark follows the Step epilogue
	return finished -- C:289 T:286; ordinary Boolean result
end

return { collect_step = collect_step }
