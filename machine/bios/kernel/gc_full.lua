module<const>

-- Source basis: 000c50c1e7613d2f04f97110586c74fa58713a68.
-- C: gc_heap.cpp; T: gc_heap.ts; X/Y: C++/TS CPU grant admission.
local layout<const> = require('kernel/gc_runtime_layout') -- C:1026,1261-1262,1270 T:1319
local control_layout<const> = require('kernel/gc_control') -- C:1234,1241 T:1136,1142
local collector<const> = require('kernel/gc_step') -- C:1239-1243 T:1139-1144
local cycles_per_word<const> = 3 -- X:2645-2647 Y:2602-2605; allowance only, never a CPU charge

local collect_full<const> = function(management) -- C:1230-1243 T:1134-1144
	local device_cycles_remaining<const>: *word = layout.remaining_device_cycles_address -- X:2644-2646 Y:2602-2604; sample the hardware clock after paying for the load
	local control<const> = management + layout.control_offset -- C:1234,1241 T:1136,1142
	local epochs<const>: *u8 = layout.ram_base + control + control_layout.internal.full_epochs_offset -- C:1234,1241 T:1136,1142
	local effects<const>: *u32 = layout.ram_base + management + layout.effect_offset -- C:1274-1277,1300
	*epochs = control_layout.internal.active(control) and 2 or 1 -- C:1234 T:1136
	*effects = layout.publish_roots -- C:1124,1261-1277,1300-1313
	repeat -- X:2642-2644 Y:2598-2601; the guest loop continues across CPU grants
		local words = *device_cycles_remaining // cycles_per_word -- X:2645-2647 Y:2602-2605; decoded CPU cycles interpreted as a signed Integer
		if words < 1 then words = 1 end -- X:2645-2647 Y:2602-2605
		if words > collector.step_words then words = collector.step_words end -- X:2645-2647 Y:2602-2605
		collector.step(management, words, 0, 1) -- C:1239-1241 T:1139-1141; compact live thread backing only on a full collection
		if not control_layout.internal.active(control) then *epochs = *epochs - 1 end -- C:1241 T:1142
	until *epochs == 0 -- X:2643-2654 Y:2600-2609
	*effects = layout.release_string_work -- C:1284,1312-1314 T:1183,1210-1211
end

return { collect_full = collect_full }
