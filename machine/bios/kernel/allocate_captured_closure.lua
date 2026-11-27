module<const>

-- Source basis: b6e4bb3362386c5c2cf4b7f7e0ef2b6045f340f1. H/C: LuaHeap TS/C++; G/R: GcHeap TS/C++;
-- T/N: CPU TS/C++. Mapped descriptor sampling is the private bus/operand
-- producer; source order survives until preparation and recovery retire.
local layout<const> = require('kernel/gc_runtime_layout') -- H:247 C:254
local closure<const> = require('kernel/closure_capture_create') -- T:4151-4197 N:3012-3068
local admission<const> = require('kernel/heap_admission') -- H:42-106 C:41-117
local collector<const> = require('kernel/gc_step') -- G:1119-1125 R:1223-1229
local object_prefix<const> = require('kernel/dlmalloc_record').internal.object_prefix -- H:247 C:254
local current_or_fresh<const> = 0 -- H:91 C:103
local out_of_memory<const> = 9 -- H:86 C:98

local allocate_captured_closure<const> = function(management, frame, owner, binding, descriptor_address, source_cycles) -- T:4151-4197 N:3012-3068
	local state<const>, control<const>, occupied<const> = management + layout.arena_offset, -- H:243-266 C:250-272
		management + layout.control_offset, management + layout.occupied_offset -- H:243-266 C:250-272
	local workspace<const> = layout.ram_base + management + layout.firmware_data_offset -- T:4160-4166 N:3032-3035; physical BIOS scratch
	local missing<const> = closure.prepare_closure(state, frame, binding, descriptor_address, workspace) -- T:4152-4188 N:3031-3055
	if missing < 0 then return missing == -(out_of_memory + 1) and 0 or missing end -- T:4155,4177,4184 N:3031,3047,3052; unified raw closure result
	local charged<const> = closure.capture_charge(binding, missing) -- H:244-245 C:251-252
	local effects<const>: *u32 = layout.ram_base + management + layout.effect_offset -- H:95 C:106 G:1121-1124 R:1225-1229
	local roots_published = false -- H:95 C:106 G:1121-1124 R:1225-1229
	local recovery = current_or_fresh -- H:91 C:103

	local debt<const> = admission.allocation_debt(state, charged) -- H:75 C:85
	if debt < 0 then -- H:76,85 C:86,97
		if charged > admission.heap_capacity(state) then return 0 end -- H:86 C:98
		repeat -- H:94,96 C:105,107
			recovery = admission.begin_allocation_recovery(state, recovery) -- H:95 C:106 G:1119-1121 R:1223-1224
			if recovery < 0 then break end -- G:1111 R:1216; OOM after returning borrowed roots
			if not roots_published then -- H:95 C:106 G:1122-1124 R:1225-1229
				*effects = layout.publish_roots -- H:95 C:106 G:1122-1124 R:1225-1229
				roots_published = true -- H:95 C:106 G:1122-1124 R:1225-1229
			end
			local work<const> = collector.finish_epoch(management, collector.step_words, 0, 0, 0) -- H:95 C:106 G:1122-1125 R:1225-1229
			source_cycles = admission.spend_assist_allowance(source_cycles, work) -- H:95 C:106 G:1124-1125 R:1228-1229; preserve original policy allowance, not native billing
		until admission.logical_fits(state, charged) ~= 0 -- H:96 C:107
	elseif debt > 0 and source_cycles >= admission.internal.work_word_cycles then -- H:77-79 C:87-90; zero work does not credit
		local pressure<const> = admission.logical_assist_pressure(state, charged) -- H:78 C:88
		local allowance<const> = admission.limit_assist_allowance(admission.logical_assist_allowance(debt, pressure), source_cycles) -- H:79 C:89-90
		*effects = layout.publish_roots -- H:79 C:90
		roots_published = true -- H:79 C:90
		local work<const> = collector.step(management, allowance, 0, 0, 0) -- H:79 C:90
		source_cycles = admission.spend_assist_allowance(source_cycles, work) -- H:79 C:90
		admission.credit_logical_assist(state, charged, debt, pressure, work) -- H:80 C:91
	end

	if recovery >= 0 then -- H:98,247 C:109,254; failed logical admission does not enter physical reservation
		local physical<const> = charged + object_prefix * (1 + missing) -- H:247 C:254
		local allowance<const> = admission.reservation_assist_allowance(state, physical, source_cycles) -- H:101-106,247 C:112-116,254
		if allowance >= 0 then -- H:104-106 C:115-116
			if not roots_published then -- H:105 C:116
				*effects = layout.publish_roots -- H:105 C:116
				roots_published = true -- H:105 C:116
			end
			collector.step(management, allowance, 0, 0, 0) -- H:105 C:116
		end
	end

	local offset = 0 -- H:249,272 C:256,278
	while recovery >= 0 do -- H:249 C:256
		offset = closure.create_prepared_closure(state, control, occupied, frame, owner, binding, workspace, missing) -- H:250-271 T:4188-4197 C:257-277 N:3055-3068
		if offset ~= 0 then break end -- H:267 C:273
		recovery = admission.begin_allocation_recovery(state, recovery) -- H:272 C:278 G:1119-1121 R:1223-1224
		if recovery < 0 then break end -- G:1111 R:1216; terminal refusal
		if not roots_published then -- H:272 C:278 G:1122-1124 R:1225-1229
			*effects = layout.publish_roots -- H:272 C:278 G:1122-1124 R:1225-1229
			roots_published = true -- H:272 C:278 G:1122-1124 R:1225-1229
		end
		collector.finish_epoch(management, collector.step_words, 0, 0, 0) -- H:272 C:278 G:1122-1125 R:1225-1229; physical retry does not repeat admission or prep
	end
	if roots_published then *effects = layout.release_string_work end -- H:272 C:278 G:1122-1125 R:1225-1229; release borrowed roots at activation boundary
	return offset -- H:267,272 T:4197 C:273,278 N:3068
end

return { allocate_captured_closure = allocate_captured_closure }
