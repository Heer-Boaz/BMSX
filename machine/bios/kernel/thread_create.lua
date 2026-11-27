module<const>

-- Source basis: da65fb039c6daeee3f08f4cec4ff232c0fe8d550.
-- T/C: TS/C++ LuaHeap; I/J/H: raw Thread layouts and constructors;
-- F/G: frame extent; A/B: allocator adapters; U/V: collector inventory;
-- P/Q: object prefix; N: C++ GC layout; S: ValueSlots; M: RAM.
-- Full operation follows T/C logical and physical admission, then one
-- scoped Closure throughout current/fresh recovery. X/Z are CPU assist
-- gates; Y is C++ projection; D the original fault; E/W Value tags.
-- Admission basis: 08c4a76d41e49d689c13a47fed3de37cece84072.
local layout<const> = require('kernel/gc_runtime_layout') -- T:177 C:189 A:25 B:20
local allocator<const> = require('kernel/dlmalloc') -- T:179-183,191-193 C:191-193,201-203 A:57-62 B:54-59
local collector<const> = require('kernel/gc_control') -- T:186-187 C:195-197 U:147-155 V:235-244
local admission<const> = require('kernel/heap_admission') -- T:42-106,175-176 C:41-116,187-188
local collection<const> = require('kernel/gc_step') -- U:1110-1124 V:1213-1227

local object_prefix<const> = 8 -- T:179,185 C:191,194 P:6,9 Q:9,13
local thread_kind<const> = 4 -- I:33 H:18
local thread_tag<const> = 9 -- E:9-11 W:21-22
local out_of_memory<const> = 9 -- T:86 U:1111 C:98 V:1214 D:43
local invalid_argument<const> = 10 -- D:44; mismatched Value or nonissued Closure
local closure_tag<const> = 7 -- E:9-11 W:21-22
local record_mask<const> = 0x003ffff8 -- P:5-7 Q:12-13
local current_or_fresh<const> = 0 -- T:92 C:103 U:1112 V:1215
local values_count<const> = 8 -- T:171 I:31 C:183 H:16
local frame_count<const> = 2 -- T:172 I:32 C:184 H:17
local value_bytes<const> = values_count * 5 -- T:171 I:29,31 C:183 H:14,16
local frame_bytes<const> = frame_count * 56 -- T:172 I:32 C:184 H:17 F:21 G:34

struct new_thread_record
	header: u32 -- I:21-22,104 J:77 H:20-21
	gray: u32 -- I:22,103 J:76 H:21
	status: u32 -- I:22,27,103 J:76 H:12,21
	resumer: addr -- I:22,103 J:76 H:21
	entry: addr -- I:22,105 J:78 H:21
	stack_top: u32 -- I:22,103 J:76 H:21
	stack_block: addr -- I:22,106 J:79 H:21
	stack_capacity: u32 -- I:22,108 J:81 H:21
	frame_capacity: u32 -- I:23,109 J:82 H:22
	protected_capacity: u32 -- I:23,103 J:76 H:22
	error_word: u32 -- I:23,103 J:76 H:22
	error_kind: u32 -- I:23,103 J:76 H:22
	call_base: u32 -- I:23,103 J:76 H:22
	return_count: u32 -- I:23,103 J:76 H:22
	frame_depth: u32 -- I:24,103 J:76 H:23
	protected_depth: u32 -- I:24,103 J:76 H:23
	frame_block: addr -- I:24,107 J:80 H:23
	protected_block: addr -- I:24,103 J:76 H:23
	reserved: u32[2] -- I:24,28,103 J:76 H:13,23
end

local record_bytes<const> = sizeof(new_thread_record) -- T:173,179 C:185,191 I:28 H:13
local charged<const> = record_bytes + value_bytes + frame_bytes -- T:173 C:185

local create_thread<const> = function(management, entry) -- T:170,178 C:182,190; one iteration of the owner's retry loop
	local arena<const> = management + layout.arena_offset -- T:177 A:25 C:189 B:20
	local base<const> = allocator.bmsx_dlmalloc_allocate(arena, record_bytes + object_prefix, 1) -- T:179 C:191 A:57-59 B:54-56
	if base ~= 0 then -- T:180 C:191
		local values<const> = allocator.bmsx_dlmalloc_allocate(arena, value_bytes, 0) -- T:181 C:192 A:57-59 B:54-56
		if values ~= 0 then -- T:182 C:192
			local frames<const> = allocator.bmsx_dlmalloc_allocate(arena, frame_bytes, 0) -- T:183 C:193 A:57-59 B:54-56
			if frames ~= 0 then -- T:184 C:193
				local offset<const> = base + object_prefix -- T:185 C:194
				local address<const> = layout.ram_base + offset -- T:185 A:59 C:194 B:56 M:6
				local words<const>: *u32 = address -- I:101,103 J:73-76 M:9; allocator returns aligned in-bank offsets
				for index = 0, (record_bytes >> 2) - 1 do words[index] = 0 end -- I:103,112 J:76,87; ordinary stores track the original cleared extent
				local record<const>: *new_thread_record = address -- T:186 C:196 I:100-101,104-109 J:72,74-82
				local control<const> = management + layout.control_offset -- T:186 C:195-196 U:102 N:94
				local white<const>: *u8 = layout.ram_base + control + collector.internal.white_offset -- T:186 U:102 C:196 J:77 N:94
				record.header = thread_kind | ((*white & 1) << 8) -- I:104 J:77 U:102 N:94
				record.entry = entry -- I:105 J:78
				record.stack_block = layout.ram_base + values -- I:106 A:59 J:79 B:56
				record.frame_block = layout.ram_base + frames -- I:107 A:59 J:80 B:56
				record.stack_capacity = values_count -- I:108 J:81
				record.frame_capacity = frame_count -- I:109 J:82
				local frame_words<const>: *u32 = layout.ram_base + frames -- I:102,110-111 J:83-86 H:41 M:9
				for index = 0, (frame_bytes >> 2) - 1 do frame_words[index] = 0 end -- I:110-111 J:85-86
				local value_words<const>: *u32 = layout.ram_base + values -- I:102,113-116 J:83,88 H:38 M:9
				for index = 0, values_count - 1 do value_words[index] = 0 end -- I:113,115 J:88 H:38,43-46 S:75-87,168-176
				local value_tags<const>: *u32 = layout.ram_base + values + 4 * values_count -- I:114,116 J:88 H:38,43-46 S:75-87,168-176; eight aligned tag bytes
				for index = 0, (values_count >> 2) - 1 do value_tags[index] = 0 end -- I:114,116 J:88 H:38,43-46 S:75-87,168-176
				collector.publish_object(control, address) -- T:187 C:197 U:147-155 V:235-244
				local occupied<const>: *u32 = layout.ram_base + management + layout.occupied_offset -- T:29,188,283-285 C:24,198,286-288
				*occupied = *occupied + charged -- T:173,188,283-285 C:185,198,286-288
				return offset -- T:185,189 C:194,199 A:59 B:56; private result is an arena offset
			end
			allocator.bmsx_dlmalloc_free(arena, values) -- T:191 C:201 A:62 B:59
		end
		allocator.bmsx_dlmalloc_free(arena, base) -- T:193 C:203 A:62 B:59
	end
	return 0 -- T:195 C:205; caller takes the original recovery branch
end

local allocate_coroutine<const> = function(management, entry, source_cycles) -- T:170,174-178,195 C:182,186-190,205; ingress has already resolved the Closure
	local arena<const> = management + layout.arena_offset -- T:177 A:25 C:189 B:20
	local effects<const>: *u32 = layout.ram_base + management + layout.effect_offset -- X:3996,4007 Y:169,181; private projection borrows ordinary roots
	local roots_published = false -- X:3996-4010 Y:169-184; no root publication on allocator-only attempts
	local recovery = current_or_fresh -- T:92,175 C:103,187
	local debt<const> = admission.allocation_debt(arena, charged) -- T:75,85 C:85,97
	if debt < 0 then -- T:76,93 C:86,104
		if charged > admission.heap_capacity(arena) then return 0 end -- T:86 C:98; impossible request never collects
		repeat -- T:94,175 C:105,187
			recovery = admission.begin_allocation_recovery(arena, recovery) -- T:95 C:106 U:1110-1117 V:1213-1224
			if recovery < 0 then -- U:1111 V:1214; logical admission exhausted its recovery epochs
				*effects = layout.release_string_work -- X:4007-4010 Y:181-184
				return 0 -- U:1111 V:1214 D:43
			end
			if not roots_published then -- X:3996-4005 Y:169-178
				*effects = layout.publish_roots -- T:95,174 C:106,186 U:1123 V:1226
				roots_published = true -- X:3996-4005 Y:169-178
			end
			local work<const> = collection.finish_epoch(management, collection.step_words, 0, 0, entry) -- U:1123 V:1226; Entry is the single explicit root
			source_cycles = admission.spend_assist_allowance(source_cycles, work) -- X:5179-5181 Z:2791-2793; preserve the source grant, not a clock debit
		until admission.logical_fits(arena, charged) ~= 0 -- T:96 C:107
	elseif debt > 0 and source_cycles >= admission.internal.work_word_cycles then -- T:77-79 C:87-90 X:5183-5188 Z:2795-2801
		local pressure<const> = admission.logical_assist_pressure(arena, charged) -- T:78 C:88
		local words<const> = admission.limit_assist_allowance(admission.logical_assist_allowance(debt, pressure), source_cycles) -- T:79 C:89-90 X:5183-5187 Z:2795-2799
		*effects = layout.publish_roots -- T:79,174 C:90,186 X:3996 Y:169
		roots_published = true -- X:3996-4005 Y:169-178
		local work<const> = collection.step(management, words, 0, 0, entry) -- X:5189 Z:2801
		source_cycles = admission.spend_assist_allowance(source_cycles, work) -- X:5190 Z:2802
		admission.credit_logical_assist(arena, charged, debt, pressure, work) -- T:80 C:91
	end
	local words<const> = admission.reservation_assist_allowance(arena, charged + object_prefix, source_cycles) -- T:101-106,176 C:112-116,188 U:934-953 V:985-1003
	if words >= 0 then -- U:952-953 V:1001-1002; a present zero-word allowance still invokes the source quantum
		if not roots_published then -- X:3996-4005 Y:169-178
			*effects = layout.publish_roots -- T:105,176 C:116,188 X:3996 Y:169
			roots_published = true -- X:3996-4005 Y:169-178
		end
		collection.step(management, words, 0, 0, entry) -- X:5189 Z:2801
	end
	while true do -- T:178 C:190
		local offset<const> = create_thread(management, entry) -- T:179-193 C:191-203
		if offset ~= 0 then -- T:184-189 C:193-199
			if roots_published then *effects = layout.release_string_work end -- X:4007-4010 Y:181-184
			return offset -- T:189 C:199; physical result remains an arena offset
		end
		recovery = admission.begin_allocation_recovery(arena, recovery) -- T:195 C:205 U:1110-1117 V:1213-1224
		if recovery < 0 then break end -- U:1111 V:1214
		if not roots_published then -- X:3996-4005 Y:169-178
			*effects = layout.publish_roots -- T:195 C:205 X:3996 Y:169
			roots_published = true -- X:3996-4005 Y:169-178
		end
		collection.finish_epoch(management, collection.step_words, 0, 0, entry) -- U:1123 V:1226; retry starts at raw reservation, not admission
	end
	if roots_published then *effects = layout.release_string_work end -- X:4007-4010 Y:181-184
	return 0 -- U:1111 V:1214 D:43
end

-- CALL ingress basis: f48d8f3c8917ccae4ffded4d790acb9ebd194cfc. K/L: TS/C++ CPU gate; O/R: exact tagged Closure decode.
local create_coroutine<const> = function(entry) -- K:4559-4570 L:1301-1309
	local management_port<const>: *u32 = layout.management_address -- K:4564 L:1306; ordinary resident port
	local source_cycles<const>: *u32 = layout.call_cycles_address -- K:4566 L:1306; latched actual device horizon
	local fault<const>: *u32 = layout.call_fault_address -- K:4561 L:1303; generic CALL fault retirement
	local management<const> = *management_port -- K:4564 L:1306
	local address<const> = layout.ram_base + management + layout.value_cell_offset -- K:4560 L:1302; existing typed cell
	local cell<const>: *value = address -- K:4560 L:1302
	local word<const>: *u32 = address -- K:4560 L:1302 O:139-143 R:254-257
	local tag<const>: *u8 = address + layout.value_cell_tag_offset -- K:4560 L:1302
	*cell = entry -- K:4560 L:1302; ordinary typed argument
	if *tag ~= closure_tag then -- K:4560-4561 L:1302-1303
		*fault = invalid_argument -- K:4561 L:1303
		return nil -- K:4561 L:1303
	end
	local offset<const> = *word & record_mask -- O:139-143,151-153 R:254-257,276-278
	local kind<const>: *u8 = layout.ram_base + offset -- O:140-142 R:255-257
	if *kind ~= closure_tag or allocator.bmsx_dlmalloc_is_object(management + layout.arena_offset, offset - object_prefix) == 0 then -- O:140-143 R:255-257
		*fault = invalid_argument -- K:4561 L:1303
		return nil -- K:4561 L:1303
	end
	local thread<const> = allocate_coroutine(management, layout.ram_base + offset, *source_cycles) -- K:4564-4568 L:1306-1308 T:174-195 C:186-205
	if thread == 0 then -- T:195 U:1111 C:205 V:1214
		*fault = out_of_memory -- U:1111 V:1214 D:43
		return nil -- K:4561 L:1303
	end
	*word = layout.ram_base + thread -- T:185,189 C:194,199 E:9-11 W:21-22
	*tag = thread_tag -- T:189 C:199 E:9-11 W:21-22
	return *cell -- T:189 C:199 E:9-11 W:21-22; ordinary tagged RET
end

return { create_thread = create_thread, create_coroutine = create_coroutine, internal = { allocate_coroutine = allocate_coroutine } }
