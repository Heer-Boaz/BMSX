module<const>

-- Source basis: 000c50c1e7613d2f04f97110586c74fa58713a68.
-- C: gc_heap.cpp; T: gc_heap.ts; X/Y: C++/TS CPU grant admission.
-- P/Q: C++/TS CPU service boundary at 59fb80ee550356ff2fa39e57ba4944ae808b4742.
local layout<const> = require('kernel/gc_runtime_layout') -- C:1026,1261-1262,1270 T:1319
local root_inputs<const> = require('kernel/gc_root_inputs') -- C:1274-1277,1300
local control_layout<const> = require('kernel/gc_control') -- C:1234,1241 T:1136,1142
local collector<const> = require('kernel/gc_step') -- C:1239-1243 T:1139-1144
local admission<const> = require('kernel/heap_admission') -- P:1312 Q:4474; budget comes from the owning layout
local cycles_per_word<const> = 3 -- X:2645-2647 Y:2602-2605; allowance only, never a CPU charge

local collect_full<const> = function() -- C:1230-1243 T:1134-1144
	local management_port<const>: *u32 = layout.management_address -- P:1307 Q:4468; ordinary CALL carries no control arguments
	local management<const> = *management_port -- P:1307 Q:4468
	local device_cycles_remaining<const>: *word = layout.remaining_device_cycles_address -- X:2644-2646 Y:2602-2604; sample the hardware clock after paying for the load
	local control<const> = management + layout.control_offset -- C:1234,1241 T:1136,1142
	local epochs<const>: *u8 = layout.ram_base + control + control_layout.internal.full_epochs_offset -- C:1234,1241 T:1136,1142
	*epochs = control_layout.internal.active(control) and 2 or 1 -- C:1234 T:1136
	root_inputs.publish(management) -- C:1124,1261-1277,1300-1313
	repeat -- X:2642-2644 Y:2598-2601; the guest loop continues across CPU grants
		local words = *device_cycles_remaining // cycles_per_word -- X:2645-2647 Y:2602-2605; decoded CPU cycles interpreted as a signed Integer
		if words < 1 then words = 1 end -- X:2645-2647 Y:2602-2605
		if words > collector.step_words then words = collector.step_words end -- X:2645-2647 Y:2602-2605
		collector.step(management, words, 0, 1, 0) -- C:1239-1241 T:1139-1141; compact live thread backing only on a full collection
		if not control_layout.internal.active(control) then *epochs = *epochs - 1 end -- C:1241 T:1142
	until *epochs == 0 -- X:2643-2654 Y:2600-2609
	root_inputs.release_string_work(management) -- C:1284,1312-1314 T:1183,1210-1211
end

local heap_bytes<const> = function() -- P:1310-1312 Q:4472-4474
	local management_port<const>: *u32 = layout.management_address -- P:1311 Q:4473; exposes the owner of both ledgers
	local management<const> = *management_port -- P:1311 Q:4473
	local occupied<const>: *u32 = layout.ram_base + management + layout.occupied_offset -- P:1311 Q:4473
	local used<const> = *occupied -- P:1311 Q:4473
	local capacity<const> = admission.heap_capacity(management + layout.arena_offset) -- P:1312 Q:4474
	return used, capacity -- P:1311-1312 Q:4473-4474
end

return { collect_full = collect_full, heap_bytes = heap_bytes }
