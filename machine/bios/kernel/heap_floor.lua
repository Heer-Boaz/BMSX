module<const>

-- Source basis: 277bea571bdf8be4c42cc2fb66f92ba59fa81f63.
-- T/C CPU EXEC retirement; G/H synchronous TS/C++ collector; K its C++ constants.
local layout<const> = require('kernel/gc_runtime_layout') -- T:1872 C:933
local root_inputs<const> = require('kernel/gc_root_inputs') -- G:966-970 H:1029-1039
local allocator<const> = require('kernel/dlmalloc') -- T:1868 C:920
local gc<const> = require('kernel/gc_control') -- G:1038-1039 H:1137-1138
local collector<const> = require('kernel/gc_step') -- G:903-917 H:978-985
local atomic<const> = 3 -- K:20

local collect_for_floor<const> = function(management, control, epochs) -- G:903-917,1038-1039 H:978-985,1137-1138
	repeat -- G:1038-1039 H:1137-1138
		if gc.internal.phase(control) == atomic then -- G:906 H:981
			collector.finish_atomic(management, 0, false) -- G:906 H:693-706,981; stopped work is accounted once
		else -- G:906,908 H:981-982
			collector.step(management, collector.step_words, 0, 1, 0) -- G:908-911,1038-1039 H:982-984,1137-1138; full collection compacts threads
		end
		if not gc.internal.active(control) then epochs = epochs - 1 end -- G:1038-1039 H:1137-1138
	until epochs == 0 -- G:1038-1039 H:1137-1138
end

local reserve_floor<const> = function(management, floor) -- T:1865-1868 C:913-920; same complete CPU transfer input
	local arena<const> = management + layout.arena_offset -- T:1866 C:919
	local accepted<const> = allocator.bmsx_dlmalloc_set_floor(arena, floor) -- T:1868,1879 C:920,941
	if accepted ~= 0 then return accepted end -- T:1879-1885 C:941-945

	local control<const> = management + layout.control_offset -- G:906,908-911 H:981-984; fixed guest state
	local epochs<const> = gc.internal.active(control) and 2 or 1 -- G:1038-1039 H:1137-1138
	root_inputs.publish_interrupt(management) -- G:958-970 H:1023-1039
	collect_for_floor(management, control, epochs)
	root_inputs.release_string_work(management) -- G:971-978 H:1042-1049; return outstanding mark credit
	return (allocator.bmsx_dlmalloc_set_floor(arena, floor)) -- T:1886-1891 C:946-950; exactly one retry
end

-- The caller reads its image header on the mapped bus. Only the
-- allocator's existing private state is accessed in this activation.
local admit_static_end<const> = function(static_end)
	local management<const> = layout.management_offset
	if static_end < 0x08040000 then static_end = 0x08040000 end
	local offset = static_end - layout.ram_base
	if offset > management then offset = management end
	local floor<const> = (offset + 4095) & ~4095
	if reserve_floor(management, floor) == 0 then return 0 end
	return layout.ram_base + floor
end

return { internal = { collect_for_floor = collect_for_floor, reserve_floor = reserve_floor }, admit_static_end = admit_static_end }
