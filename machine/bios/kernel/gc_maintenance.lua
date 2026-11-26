module<const>

-- Source basis: 027fe97a6495926028a4cea6ef8cd15af8f5d191.
-- C/H: gc_heap.cpp/.h; E: cpu_executor.cpp; V: vblank.cpp.
-- VBlank admission and an admitted stopped final mark are one BIOS
-- activation. The mutator is still paused when this routine returns.
local layout<const> = require('kernel/gc_runtime_layout') -- C:1261-1262,1270,1300
local gc<const> = require('kernel/gc_control') -- C:689,701,936
local vblank<const> = require('kernel/gc_vblank') -- C:929-954 V:90
local collector<const> = require('kernel/gc_step') -- C:697-701,952-953
local atomic_phase<const> = 3 -- H:20

local vblank_maintenance<const> = function(management, waiting, rebuilding) -- C:929 V:76-91
	local limit<const> = vblank.admit_vblank_collection(management + layout.arena_offset, waiting, rebuilding) -- C:930-952
	if limit == 0 then return 0 end -- C:930-931,937,939,947

	local control<const> = management + layout.control_offset -- C:933,936
	local effects<const>: *u32 = layout.ram_base + management + layout.effect_offset -- C:1274-1277,1300
	local borrows_roots<const> = gc.internal.phase(control) < atomic_phase -- C:937,1093-1158
	if borrows_roots then *effects = layout.publish_roots end -- C:1124,1261-1277,1300-1313
	local work = collector.step(management, limit, 0, 0) -- C:952-953
	while gc.internal.phase(control) == atomic_phase do -- C:689,701 E:155,201
		work = work + collector.step(management, collector.step_words, 0, 0) -- C:697-701; final mark still uses its original policy quanta
	end
	if borrows_roots then *effects = layout.release_string_work end -- C:1273,1313-1315; return unconsumed work to the latch
	return work -- C:702,1045; not a cycle charge
end

return { vblank_maintenance = vblank_maintenance }
