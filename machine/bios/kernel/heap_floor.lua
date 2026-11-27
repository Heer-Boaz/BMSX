module<const>

-- Source basis: 277bea571bdf8be4c42cc2fb66f92ba59fa81f63.
-- T/C CPU EXEC retirement; G/H synchronous TS/C++ collector; K its C++ constants.
local layout<const> = require('kernel/gc_runtime_layout') -- T:1872 C:933
local allocator<const> = require('kernel/dlmalloc') -- T:1868 C:920
local gc<const> = require('kernel/gc_control') -- G:1038-1039 H:1137-1138
local collector<const> = require('kernel/gc_step') -- G:903-917 H:978-985
local atomic<const> = 3 -- K:20

local reserve_floor<const> = function(management, floor) -- T:1865-1868 C:913-920; same complete CPU transfer input
	local arena<const> = management + layout.arena_offset -- T:1866 C:919
	local accepted<const> = allocator.bmsx_dlmalloc_set_floor(arena, floor) -- T:1868,1879 C:920,941
	if accepted ~= 0 then return accepted end -- T:1879-1885 C:941-945

	local control<const> = management + layout.control_offset -- G:906,908-911 H:981-984; fixed guest state
	local effects<const>: *u32 = layout.ram_base + management + layout.effect_offset -- G:966-970 H:1029-1039; generic publication of existing CPU roots
	local epochs = gc.internal.active(control) and 2 or 1 -- G:1038-1039 H:1137-1138
	*effects = layout.publish_roots -- G:958-970 H:1023-1039
	repeat -- G:1038-1039 H:1137-1138
		if gc.internal.phase(control) == atomic then -- G:906 H:981
			collector.finish_atomic(management, 0, false) -- G:906 H:693-706,981; stopped work is accounted once
		else -- G:906,908 H:981-982
			collector.step(management, collector.step_words, 0, 1, 0) -- G:908-911,1038-1039 H:982-984,1137-1138; full collection compacts threads
		end
		if not gc.internal.active(control) then epochs = epochs - 1 end -- G:1038-1039 H:1137-1138
	until epochs == 0 -- G:1038-1039 H:1137-1138
	*effects = layout.release_string_work -- G:971-978 H:1042-1049; return outstanding mark credit
	return (allocator.bmsx_dlmalloc_set_floor(arena, floor)) -- T:1886-1891 C:946-950; exactly one retry
end

return { reserve_floor = reserve_floor }
