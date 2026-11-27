module<const>

-- Source basis: e3774a03a44e94be4d9d8be73c7ce2de80a336c2.
-- T/C StringPool; L/N LuaHeap; G/Q original GC recovery;
-- X/Y original CPU builtin and policy gate; Z C++ fixed activation. The borrowed bytes retain
-- their one canonical String root through optional rehash, logical/physical
-- assists and current/fresh refusal. Only live BLua instructions cost time.
local layout<const> = require('kernel/gc_runtime_layout') -- T:371,395 C:361,386
local root_inputs<const> = require('kernel/gc_root_inputs') -- X:4116-4132 Z:295-314
local roots<const> = require('kernel/gc_operand_roots') -- T:366-368 C:356-359
local slices<const> = require('kernel/string_slice') -- T:351-428 C:347-415
local strings<const> = require('kernel/gc_strings') -- T:367,378-380,428,431-441 C:358,368-370,415,418-429
local admission<const> = require('kernel/heap_admission') -- L:42-106,134-144,160-167 N:41-116,147-183
local collector<const> = require('kernel/gc_step') -- G:1109-1124 Q:1213-1229
local allocator<const> = require('kernel/dlmalloc') -- T:373 C:363 L:164 N:177
local thread_storage<const> = require('kernel/thread_frame_storage') -- W:16-19,135-136
local records<const> = require('kernel/dlmalloc_record') -- T:393 C:383 L:109-131,151-154 N:119-139,151-154

local ram_size<const> = 0x00400000 -- T:393 C:382
local header_bytes<const> = 16 -- T:353,393 C:382-383
local string_tag<const> = 5 -- L:160 T:368 C:359; tagged result
local current_or_fresh<const> = 0 -- L:92,160 N:103,174
local initial_bytes<const> = 4 * slices.initial_buckets -- T:24,373 C:25,363

local begin_string_work<const> = function(management, projected) -- X:4116-4126 Z:295-307
	if projected then -- X:4116-4126 Z:295-307
		root_inputs.borrow_string_work(management) -- X:4116-4126 Z:295-307
	else -- X:4116-4126 Z:295-307
		root_inputs.publish(management) -- X:4116-4126 Z:295-307
	end
end

-- A first directory, unlike optional growth, is a required backing
-- allocation. Its separate recovery token is not inherited by the String.
local reserve_initial_directory<const> = function(management, arena, scope, source_cycles, projected) -- T:372-377 C:362-367 L:160-168 N:173-180
	local published = false -- L:162,165 N:175,178; only actual collector calls borrow roots
	local words<const> = admission.reservation_assist_allowance(arena, initial_bytes, source_cycles) -- L:162 N:175
	if words >= 0 then -- L:104-106,162 N:113-116,175
		begin_string_work(management, projected) -- L:162 N:175
		published = true -- L:162 N:175
		local work<const> = collector.step(management, words, 0, 0, scope) -- L:105,162 N:116,175
		source_cycles = admission.spend_assist_allowance(source_cycles, work) -- X:5366-5378 Y:2782-2794
	end
	local recovery = current_or_fresh -- L:160-161 N:173-174
	while true do -- L:163-166 N:176-179
		local offset<const> = allocator.bmsx_dlmalloc_allocate(arena, initial_bytes, 0) -- L:164 N:177
		if offset ~= 0 then return offset, source_cycles, published end -- L:165 N:177
		recovery = admission.begin_allocation_recovery(arena, recovery) -- L:166 N:178
		if recovery < 0 then return 0, source_cycles, published end -- G:1111 Q:1214
		if not published then -- L:166 N:178
			begin_string_work(management, projected) -- L:166 N:178
			published = true -- L:166 N:178
		end
		local work<const> = collector.finish_epoch(management, collector.step_words, 0, 0, scope) -- L:166 G:1123 N:178 Q:1226
		source_cycles = admission.spend_assist_allowance(source_cycles, work) -- X:5366-5378 Y:2782-2794
	end
end

-- All mutable String producers run this sequence only after a canonical
-- lookup miss. Keep root borrow through publication of the admitted record.
local reserve_string_record<const> = function(management, metadata, length, scope, source_cycles, projected) -- T:370-393 C:361-383
	local arena<const> = management + layout.arena_offset -- L:113 N:120
	local state<const>: *string_metadata = layout.ram_base + metadata -- T:370 C:361
	local published = false -- L:79,96,105 N:91,107,116
	if (state.capacity & strings.internal.ram_bucket_extent_mask) == 0 then -- T:370-372 C:361-362
		local offset -- T:373 C:363
		offset, source_cycles, published = reserve_initial_directory(management, arena, scope, source_cycles, projected) -- T:373 C:363
		if offset == 0 then -- T:373 C:363 L:166 N:178
			return 0, published -- G:1111 Q:1214; caller releases borrowed String work
		end
		slices.publish_initial_directory(metadata, offset) -- T:374-377 C:364-367
	else -- T:378 C:368
		slices.prepare_existing_directory(metadata, arena) -- T:370,378-391 C:361,368-380
	end

	local bytes<const> = header_bytes + (length < ram_size and length or ram_size) -- T:393 C:382-383 N:168-170
	local recovery = current_or_fresh -- L:92 N:103
	local debt<const> = admission.allocation_debt(arena, bytes) -- L:75,85 C:383 N:85,97
	if debt < 0 then -- L:76,93 N:86,104
		if bytes > admission.heap_capacity(arena) then -- L:86 N:98; impossible request
			return 0, published -- L:86 N:98
		end
		repeat -- L:94-96 N:105-107
			recovery = admission.begin_allocation_recovery(arena, recovery) -- L:95 N:106
			if recovery < 0 then -- G:1111 Q:1214
				return 0, published -- G:1111 Q:1214
			end
			if not published then -- L:95 N:106
				begin_string_work(management, projected) -- L:95 N:106
				published = true -- L:95 N:106
			end
			local work<const> = collector.finish_epoch(management, collector.step_words, 0, 0, scope) -- G:1123 Q:1226
			source_cycles = admission.spend_assist_allowance(source_cycles, work) -- X:5366-5378 Y:2782-2794
		until admission.logical_fits(arena, bytes) ~= 0 -- L:96 N:107
	elseif debt > 0 and source_cycles >= admission.internal.work_word_cycles then -- L:77-79 N:87-90
		local pressure<const> = admission.logical_assist_pressure(arena, bytes) -- L:78 N:88
		local words<const> = admission.limit_assist_allowance(admission.logical_assist_allowance(debt, pressure), source_cycles) -- L:79 N:89-90
		if not published then -- L:79 N:90
			begin_string_work(management, projected) -- L:79 N:90
			published = true -- L:79 N:90
		end
		local work<const> = collector.step(management, words, 0, 0, scope) -- L:79 N:90
		source_cycles = admission.spend_assist_allowance(source_cycles, work) -- X:5366-5378 Y:2782-2794
		admission.credit_logical_assist(arena, bytes, debt, pressure, work) -- L:80 N:91
	end
	local words<const> = admission.reservation_assist_allowance(arena, bytes, source_cycles) -- L:140,105 N:169,116
	if words >= 0 then -- L:105 N:116
		if not published then -- L:105 N:116
			begin_string_work(management, projected) -- L:105 N:116
			published = true -- L:105 N:116
		end
		collector.step(management, words, 0, 0, scope) -- L:105 N:116
	end
	local occupied<const> = management + layout.occupied_offset -- L:128 N:135
	local offset -- L:151-153 N:151-154
	while true do -- L:152 N:151
		offset = records.bmsx_dlmalloc_reserve_record(arena, bytes, 0, 0, 0, bytes, 0, 0, occupied) -- L:153 N:152
		if offset ~= 0 then break end -- L:154 N:152
		recovery = admission.begin_allocation_recovery(arena, recovery) -- L:155 N:153
		if recovery < 0 then break end -- G:1111 Q:1214
		if not published then -- L:155 N:153
			begin_string_work(management, projected) -- L:155 N:153
			published = true -- L:155 N:153
		end
		collector.finish_epoch(management, collector.step_words, 0, 0, scope) -- L:155 N:153 G:1123 Q:1226
	end
	return offset, published -- L:151-155 N:151-154
end

local allocate_slice<const> = function(management, source, first, length, source_cycles, system, cart0, cart1) -- T:232-241,351-428 C:238-244,347-415 L:134-155 N:146-172
	local metadata<const> = management + layout.metadata_offset -- T:65,370 C:42,361
	-- Both mirrors already borrow these exact spans before lookup. Pinned
	-- retention preserves their backing through allocation and GC; no rebinding
	-- or host byte buffer is needed at publication.
	local start<const>, head<const> = slices.slice_head(source, first, length) -- T:351-356 C:347-348
	local hash<const> = slices.hash_span(start, head, length) -- T:356 C:349
	local id = slices.lookup_ram(metadata, start, head, length, hash, nil, nil) -- T:233-234,360-362 C:239,350
	if id == 0 then -- T:235-241,361 C:240-244,350
		local fault -- T:217-222 C:228-232; explicit external-read outcome
		id, fault = slices.lookup_rom_directories(metadata, start, head, length, hash, system, cart0, cart1, nil, nil) -- T:235-241,361 C:240-244,350
		if fault ~= 0 then return 0, fault end -- T:217-222 C:228-232; no roots, reservations or directory writes on a failed read
	end
	if id ~= 0 then -- T:362 C:350
		strings.mark(metadata, id) -- T:362,439-442 C:350,427-430; fixed call owns result, no native local-root stack
		return id, 0 -- T:362 C:350
	end

	strings.mark(metadata, source) -- T:365-367 C:354-358; non-null admitted String, no carry for direct retain
	local scope<const> = roots.single_value_scope(management, string_tag, source) -- T:366-368 C:356-359; genuine explicit Value, not a host byte buffer
	local offset<const>, published<const> = reserve_string_record(management, metadata, length, scope, source_cycles, false) -- T:370-393 C:361-383 L:134-155 N:146-172
	if offset ~= 0 then -- L:153 N:152
		id = slices.publish(metadata, layout.ram_base + offset, start, head, length, hash) -- T:394-428 C:384-415
	end
	if published then root_inputs.release_string_work(management) end -- G:657 Q:678
	return id, 0 -- T:428 C:415 G:1111 Q:1214; zero is allocation refusal after all retries
end

-- The existing register planes remain the sources and the roots throughout
-- this one firmware activation. Replaying their spelling keeps an intern
-- hit allocation-free and avoids an arena-sized temporary byte record.
local intern_concat<const> = function(management, owner, first, count, source_cycles, system, cart0, cart1) -- W:16-19,135-136
	local words<const>, tags<const> = thread_storage.internal.value_planes(owner, first) -- W:16-19,135-136
	local metadata<const> = management + layout.metadata_offset -- T:65,370 C:42,361
	local workspace<const> = layout.ram_base + management + layout.firmware_data_offset -- V:135-136 W:17-19
	local length<const>, hash<const> = slices.hash_concat(words, tags, count, workspace) -- W:48,130-131 C:335-337
	if length == ram_size then return 0, 0 end -- W:20-24 P:3059-3063
	local id = slices.lookup_ram(metadata, words, tags, length, hash, count, workspace) -- C:328,332-338 T:232-235
	if id == 0 then -- C:328,332-338 T:232-235
		local fault -- C:328,332-338 T:232-235
		id, fault = slices.lookup_rom_directories(metadata, words, tags, length, hash, system, cart0, cart1, count, workspace) -- C:228-244,338 T:217-222,235-241
		if fault ~= 0 then return 0, fault end -- C:228-244,338 T:217-222,235-241
	end
	if id ~= 0 then -- C:338 T:362,439-442
		strings.mark(metadata, id) -- C:338 T:362,439-442
		return id, 0 -- C:338 T:362,439-442
	end
	-- Unlike the host's completed temporary bytes, the borrowed operands
	-- must remain live during the existing allocator/collection retry.
	slices.retain_concat_sources(metadata, words, tags, count) -- C:339-344 T:430-436
	local offset<const>, published<const> = reserve_string_record(management, metadata, length, 0, source_cycles, true) -- C:344,361-383 T:370-393 L:151-155 N:151-155
	if offset ~= 0 then -- C:344,361-383 T:370-393 L:151-155 N:151-155
		-- Recovery can compact the Thread backing and move its tag plane.
		local live_words<const>, live_tags<const> = thread_storage.internal.value_planes(owner, first) -- W:16-19,135-136 C:339-344
		id = slices.publish_concat(metadata, layout.ram_base + offset, live_words, live_tags, count, length, hash, workspace) -- W:54-55 C:342-344,384-415 T:394-428
	end
	if published then root_inputs.release_string_work(management) end -- X:4128-4131 Z:309-312
	return id, 0 -- W:54-56 C:328-344 T:428 L:155 N:155
end

return {
	internal = {
		begin_string_work = begin_string_work, reserve_initial_directory = reserve_initial_directory,
		reserve_string_record = reserve_string_record,
	},
	intern_slice = allocate_slice, intern_concat = intern_concat,
}
