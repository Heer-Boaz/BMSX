module<const>

-- Source basis: 027fe97a6495926028a4cea6ef8cd15af8f5d191.
-- T/C: GcHeap; host-only notification stages are replaced by observing RAM.
-- The caller enters in Sweep or Strings. One activation owns the
-- original allowance, sampled occupancy, both phases and pace credit.
local layout<const> = require('kernel/gc_runtime_layout') -- T:958,983,1317-1320 C:1010,1025-1028,1065-1068
local gc<const> = require('kernel/gc_control') -- T:973,1005-1014,1082 C:1019,1167,1202-1211
local epoch<const> = require('kernel/gc_epoch') -- T:987,992-1016,1082,1088 C:1045,1072-1082,1167,1176
local arena<const> = require('kernel/dlmalloc') -- T:958 C:1010
local objects<const> = require('kernel/gc_objects') -- T:978,1081,1327 C:1036,1060-1062,1166
local strings<const> = require('kernel/gc_strings') -- T:983,1087 C:1041,1065-1069,1175
local sweep<const> = 4 -- T:70,974,1078 C:1020,1161
local string_sweep<const> = 5 -- T:70,981,1084 C:1039,1170
local native_policy<const> = 1 -- C:1033,1041,1059-1068; C++ hash/free order and exact String shrink boundary

local sweep_quantum<const> = function(state, limit, growing_thread, compact_threads) -- T:956-960,1081,1087,1340,1362-1366 C:1006-1010,1166,1175,1438-1440
	local control<const> = state + layout.control_offset -- T:973,1320 C:1019,1028
	local allocator<const> = state + layout.arena_offset -- T:958 C:1010,1060,1067
	local occupied<const> = state + layout.occupied_offset -- T:983,1327 C:1060,1068
	local metadata<const> = state + layout.metadata_offset -- T:983,1087 C:1067,1175
	local occupied_before<const> = arena.bmsx_dlmalloc_occupied_bytes(allocator) -- T:958,987 C:1010,1045
	local work = 0 -- T:1020 C:1088
	if work < limit then -- T:1064 C:1141
		local phase = gc.internal.phase(control) -- T:973,1065 C:1019,1142,1441; the BLua continuation replaces the host handoff stage
		if phase == sweep then -- T:974,1078 C:1020,1161
			local cursor<const>: *addr = layout.ram_base + control + gc.internal.sweep_link_offset -- T:1082,1320 C:1028,1167
			work = objects.sweep_objects(control, allocator, occupied, growing_thread, compact_threads, native_policy, limit) -- T:1081,1319-1328,1331-1332,1364 C:1026-1033,1060-1062,1166,1438
			if work < limit and *cursor == 0 then -- T:1082,1366 C:1167,1442
				epoch.begin_strings(control, metadata) -- T:1005-1008,1082,1367 C:1167,1202-1205,1443
				phase = string_sweep -- T:1007,1084 C:1170,1204; begin_strings has already published the phase
			end
		end
		if work < limit and phase == string_sweep then -- T:1064,1084 C:1141,1170
			work = work + strings.sweep_step(metadata, allocator, occupied, limit - work, native_policy) -- T:1087,1373,1387 C:1041,1175,1450-1451,1465
			epoch.finish_strings(control, metadata, allocator) -- T:1011-1014,1088,1384 C:1176,1208-1211,1462
		end
	end
	local accounted<const> = epoch.finish_step(control, allocator, occupied_before, work) -- T:987,992-1002 C:1045,1072-1082; only the original quantum pays pace
	return accounted -- T:987,1002 C:1045,1082; explicit full-epoch count belongs to caller
end

return { sweep_quantum = sweep_quantum }
