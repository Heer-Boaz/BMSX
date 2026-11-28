module<const>

-- Source basis: 9b002adf22c0a496d45fac0bca5cab2030cda3b9.
-- T/C/H GcHeap; I/J Thread records; F/G controls; U/V Upvalues;
-- S/N Value storage; M RAM decode; O/P object layout;
-- A/B word arithmetic.
-- The caller admits and pops a Thread gray head, or resumes its saved
-- frontier. The former native CONCATN and protected-call roots now live
-- in ordinary argument windows, with the rest of the tagged stack.
local control_layout<const> = require('kernel/gc_control') -- T:416 C:413
local captures<const> = require('kernel/gc_capture_trace') -- T:436,442 C:435,442
local mark<const> = require('kernel/gc_mark') -- T:413,417-419,431,453,474 C:414-416,430,456,482
local layout<const> = require('kernel/gc_runtime_layout') -- M:6 R:30
local ram_base<const> = layout.ram_base -- M:6
local ram_size<const> = 0x00400000 -- M:7
local byte_mask<const> = ram_size - 1 -- M:7
local word_mask<const> = ram_size - 4 -- M:9
local word_count<const> = ram_size >> 2 -- S:78 N:80
local sign_bit<const> = 0x80000000 -- T:440,485,492 C:440,494,502; unsigned record operands
local trace_head<const> = 4 -- T:25 H:23
local thread_visits<const> = 12 -- T:28 H:27
local trace_record_offset<const> = 0x34 -- T:33 H:32
local cursor_bits<const> = 20 -- T:58 O:12 C:71 P:17
local cursor_mask<const> = (1 << cursor_bits) - 1 -- T:59 C:72
local stage_frames<const> = 0 -- T:61 C:74
local stage_values<const> = 1 -- T:61 C:74
local stage_clear<const> = 2 -- T:61 C:74
local open_head<const> = 1 -- T:63 C:75
local thread_kind<const> = 4 -- I:33 J:18
local closure_kind<const> = 7 -- T:328-329 C:280-281
local thread_bytes<const> = 80 -- I:28 J:13
local slot_bytes<const> = 5 -- I:29 J:14
local frame_bytes<const> = 56 -- F:21 G:34
local frame_window_mask<const> = word_count - 1 -- F:22 G:36
local control_count_mask<const> = (1 << 18) - 1 -- I:34 J:27
local upvalue_flags<const> = 2 -- U:12 V:14
local upvalue_open<const> = 1 -- U:13 V:15
local upvalue_slot<const> = 4 -- U:15 V:17
local upvalue_next<const> = 12 -- U:17 V:19

struct thread_record
	before_resumer: u32[3] -- I:21-22 J:20-21
	resumer: addr -- I:22 J:21
	entry: addr -- I:22 J:21
	stack_top: u32 -- I:22 J:21
	stack_block: addr -- I:22 J:21
	stack_capacity: u32 -- I:22 J:21
	frame_capacity: u32 -- I:23 J:22
	_before_error: u32 -- I:23 J:22
	error_word: u32 -- I:23 J:22
	error_tag: u8 -- I:23 J:22
	after_error: u8[3] -- I:23 J:22
	base_return: u32[2] -- I:23 J:22
	frame_depth: u32 -- I:24 J:23
	_before_frames: u32 -- I:24 J:23
	frame_block: addr -- I:24 J:23
end

struct frame_record
	function_call_site: u32[2] -- F:19 G:33
	open_head: addr -- F:19 G:33
	before_vararg: u32[3] -- F:19 G:33
	vararg_base: u32 -- F:19 G:33
	argument_count: u32 -- F:19 G:33
	return_base: u32 -- F:19 G:33
	return_count: u32 -- F:19 G:33
	top: u32 -- F:19 G:33
	closure: addr -- F:19 G:33
	stack_base: u32 -- F:19 G:33
	stack_capacity: u32 -- F:19 G:33
end

struct thread_frontier
	record: addr -- T:33 H:32
	cursor: u32 -- T:34 H:33
	open: addr -- T:35 H:34
	capture_top: u32 -- T:36 H:35
end

local clear_stack_range<const> = function(offset, capacity, first, stop) -- I:143 C:497 N:75
	local count<const> = stop - first -- I:144 N:75-76; the caller's extent is strictly positive
	local words, tags = count, count -- I:145-149 S:78 N:77-81
	if (capacity ~ sign_bit) > (((ram_size - offset) // slot_bytes) ~ sign_bit) then -- I:145-149 J:43-46 S:76 N:77
		if words > word_count then words = word_count end -- S:78 N:80
		if tags > ram_size then tags = ram_size end -- S:78 N:81
	end
	local word_base<const> = offset + first * 4 -- I:150 S:75,79 N:78
	local tag_base<const> = offset + capacity * 4 + first -- I:150 S:75,80 N:79
	local index = 0 -- I:151 S:79 N:82
	while index < words do -- I:151 S:79 N:82
		local port<const>: *u32 = ram_base + ((word_base + index * 4) & word_mask) -- I:151 S:77,79 N:82
		*port = 0 -- I:151,153 S:79,83-84 N:82,86-87,168-170,172-175,183-187; record stores publish each affected RAM lane
		index = index + 1 -- I:151 S:79 N:82
	end
	index = 0 -- I:152 S:80 N:83
	while index < tags do -- I:152 S:80 N:83
		local port<const>: *u8 = ram_base + ((tag_base + index) & byte_mask) -- I:152 S:80 N:83
		*port = 0 -- I:152,154 S:80,83-84 N:83,86-87,171,174,187
		index = index + 1 -- I:152 S:80 N:83
	end
end

local trace_thread<const> = function(control, arena, metadata, address, atomic, limit, resumed, pending_string_work, replace_color_byte) -- T:410-411 C:410
	local thread<const>: *thread_record = ram_base + (address & word_mask) -- T:412,417-422 C:414-419 I:118-120 J:51-52
	local work = 0 -- T:414 C:411
	if resumed == 0 then -- T:415 C:412
		if atomic == 0 then control_layout.append_visit(control, thread_visits, address) end -- T:416 C:413
		mark.mark_record(control, arena, thread.resumer, thread_kind, trace_head, replace_color_byte) -- T:306-318,417 C:259-265,272-273,414
		local entry<const> = thread.entry -- T:418 C:415
		if (entry & layout.thread_entry_code_bit) == 0 then -- R:30; only heap Closure entries are collectible
			mark.mark_record(control, arena, entry, closure_kind, trace_head, replace_color_byte) -- T:312-318,328-329,418 C:259-265,280-281,415
		end
		local _<const>, strings<const> = mark.mark_value(control, arena, metadata, thread.error_tag, thread.error_word, trace_head, replace_color_byte) -- T:419 C:416 J:67-69
		work = (thread_bytes >> 2) + pending_string_work + strings -- T:420 C:417
		pending_string_work = 0 -- T:420 C:417; native String latch drain
	end
	local frontier<const>: *thread_frontier = ram_base + control + trace_record_offset -- T:518,522-524 C:529,537-540
	local cursor, open, capture_top = 0, open_head, 0 -- T:408 C:407
	if resumed ~= 0 then -- T:518,522-524 C:529,537-540
		cursor = frontier.cursor -- T:518 C:529
		open = frontier.open -- T:523 C:539
		capture_top = frontier.capture_top -- T:524 C:540
	end
	-- Rebind the physical backings on each entry. The unused host scratch
	-- capacities/top are not part of any scan stage.
	local offset<const> = thread.stack_block & word_mask -- T:422 I:120-121 C:419 J:37,59
	local capacity<const> = thread.stack_capacity -- T:422 I:122 C:419 J:60
	local depth<const> = thread.frame_depth & control_count_mask -- T:422 I:125 C:420 J:54-55
	local frames<const> = thread.frame_block & word_mask -- T:422 I:128-129 C:419 J:41,63
	local stage, next_index = cursor >> cursor_bits, cursor & cursor_mask -- T:423 C:421-422
	local complete = false -- T:424 C:423
	if stage == stage_frames then -- T:427 C:426
		while next_index < depth and work < limit do -- T:428 C:427
			if open == open_head then -- T:429 C:428
				local frame<const>: *frame_record = ram_base + ((frames + next_index * frame_bytes) & word_mask) -- T:430 I:133-134 C:429 J:41
				mark.mark_record(control, arena, frame.closure, closure_kind, trace_head, replace_color_byte) -- T:431 C:430
				open = frame.open_head -- T:432 C:431
				work = work + (frame_bytes >> 2) -- T:433 C:432
			end
			while open ~= 0 and work < limit do -- T:435 C:434
				local cell<const> = captures.internal.cell_record_address(arena, open) -- T:163,436 C:293,435
				if cell == 0 then open = 0; break end -- T:164,438 C:294,438
				local flags<const>: *u8 = ram_base + ((cell + upvalue_flags) & byte_mask) -- T:164 C:294 U:25-26
				if (*flags & upvalue_open) == 0 then open = 0; break end -- T:164,438 C:294,438
				local slot_word<const>: *u32 = ram_base + ((cell + upvalue_slot) & word_mask) -- T:439 C:439
				local slot<const> = *slot_word -- T:439 C:439
				if (slot ~ sign_bit) < (capacity ~ sign_bit) and ((slot + 1) ~ sign_bit) > (capture_top ~ sign_bit) then -- T:440 C:440
					capture_top = slot + 1 -- T:440 C:440
				end
				local link<const>: *u32 = ram_base + ((cell + upvalue_next) & word_mask) -- T:441 C:441
				open = *link -- T:441 C:441
				local cell_work<const>, strings<const> = captures.mark_cell(control, arena, metadata, cell, replace_color_byte) -- T:442 C:442
				work = work + (cell_work > 1 and cell_work or 1) + pending_string_work + strings -- T:442 C:442-443
				pending_string_work = 0 -- T:442 C:443
			end
			if open == 0 then next_index = next_index + 1; open = open_head end -- T:444 C:445
		end
		if next_index >= depth then stage = stage_values; next_index = 0; open = 0 end -- T:446 C:447
	end
	if stage == stage_values then -- T:458 C:462
		local live_top = capture_top -- T:459 C:463
		if depth ~= 0 then -- T:460 C:464
			local frame<const>: *frame_record = ram_base + ((frames + (depth - 1) * frame_bytes) & word_mask) -- T:461 I:133-134 C:465 J:41
			local base<const> = frame.stack_base & frame_window_mask -- T:462 C:466
			local top<const> = frame.top & frame_window_mask -- T:463 C:467
			local window<const> = frame.stack_capacity & frame_window_mask -- T:464 C:468
			local upper = top -- T:467 C:474
			if (upper ~ sign_bit) > (window ~ sign_bit) then upper = window end -- T:467 C:474
			if ((base + upper) ~ sign_bit) > (live_top ~ sign_bit) then live_top = base + upper end -- T:467 C:474
		end
		local tag_base<const> = offset + capacity * 4 -- T:469 C:476 J:43-46 N:43-45
		while (next_index ~ sign_bit) < (live_top ~ sign_bit) and work < limit do -- T:470 C:477
			local extent = (limit - work) // 3 -- T:471 C:479
			if extent < 1 then extent = 1 end -- T:471 C:479
			local stop = next_index + extent -- T:471 C:479
			if (stop ~ sign_bit) > (live_top ~ sign_bit) then stop = live_top end -- T:471 C:479
			local words<const> = ((stop * slot_bytes + 3) >> 2) - ((next_index * slot_bytes + 3) >> 2) -- T:472 C:480-481 A:66-67 B:69-70; nonnegative stack stride
			while (next_index ~ sign_bit) < (stop ~ sign_bit) do -- T:473 C:482
				local tag<const>: *u8 = ram_base + ((tag_base + next_index) & byte_mask) -- T:474 C:482 N:38-44
				local payload<const>: *u32 = ram_base + ((offset + next_index * 4) & word_mask) -- T:474 C:482 N:38-44,178-181
				local _<const>, strings<const> = mark.mark_value(control, arena, metadata, *tag, *payload, trace_head, replace_color_byte) -- T:474 C:482
				pending_string_work = pending_string_work + strings -- T:474-475 C:482-483; explicit native latch
				next_index = next_index + 1 -- T:473 C:482
			end
			work = work + words + pending_string_work -- T:475 C:483
			pending_string_work = 0 -- T:475 C:483
		end
		if (next_index ~ sign_bit) >= (live_top ~ sign_bit) then -- T:477 C:485
			if atomic ~= 0 then -- T:478 C:487
				stage = stage_clear -- T:479 C:488
				next_index = live_top -- T:480 C:489
			else complete = true end -- T:481 C:490
		end
	end
	if stage == stage_clear then -- T:484 C:493
		while (next_index ~ sign_bit) < (capacity ~ sign_bit) and work < limit do -- T:485 C:494
			local extent = (limit - work) >> 1 -- T:486 C:495-496
			if extent < 1 then extent = 1 end -- T:486 C:495-496
			local stop = next_index + extent -- T:486 C:495
			if (stop ~ sign_bit) > (capacity ~ sign_bit) then stop = capacity end -- T:486 C:495-496
			clear_stack_range(offset, capacity, next_index, stop) -- T:487 C:497
			local words<const> = ((stop * slot_bytes + 3) >> 2) - ((next_index * slot_bytes + 3) >> 2) -- T:488 C:498-499 A:66-67 B:69-70
			work = work + words -- T:489 C:498-499
			next_index = stop -- T:490 C:500
		end
		complete = (next_index ~ sign_bit) >= (capacity ~ sign_bit) -- T:492 C:502
	end
	if complete then -- T:494 C:504
		if resumed ~= 0 then -- T:495 C:505
			frontier.record = 0 -- T:496 C:506
			frontier.cursor = 0 -- T:496 C:506
			frontier.open = 0 -- T:497 C:507
			frontier.capture_top = 0 -- T:497 C:507
		end
		return work, pending_string_work -- T:499,535 C:509,553
	end
	frontier.record = address -- T:501 C:511
	frontier.cursor = (stage << cursor_bits) | next_index -- T:501 C:511
	frontier.open = open -- T:502 C:512
	frontier.capture_top = capture_top -- T:502 C:512
	return work, pending_string_work -- T:503,535 C:513,553
end

return {
	trace_thread = trace_thread,
	internal = { clear_stack_range = clear_stack_range },
}
