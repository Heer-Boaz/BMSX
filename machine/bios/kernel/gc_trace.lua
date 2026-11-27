module<const>

-- Source basis: 6a580740492a6ebdaca200fc90e243ebbcdcd230.
-- T/C/H: GcHeap; O/P: object layout; U/V: Upvalue; I/J: Thread;
-- A/B: allocator; D/E: dlmalloc; W: native Upvalue; M: RAM map;
-- S/R: String work.
local allocator<const> = require('kernel/dlmalloc') -- T:386 C:377 A:54 B:52 D:680-683
local capture<const> = require('kernel/gc_capture_trace') -- T:390-406,525 C:388-405,542
local table_head<const> = require('kernel/gc_table_head') -- T:395,520 C:393,532
local table_trace<const> = require('kernel/gc_table_trace') -- T:521 C:533-535
local threads<const> = require('kernel/gc_thread_trace') -- T:408,522-524 C:407,537-540

local ram_base<const> = 0x08000000 -- M:6
local byte_mask<const> = 0x003fffff -- M:7
local record_shift<const> = 3 -- O:5 P:8
local object_prefix<const> = 1 << record_shift -- O:6,9 P:9,13
local gray_index_mask<const> = (1 << 19) - 1 -- O:12-13 P:17-18
local color_offset<const> = 1 -- O:3 P:6
local color_mask<const> = 3 -- O:4 P:7
local gray<const> = 2 -- T:386 C:384
local allocator_state_offset<const> = 0x400 -- A:10,25 B:20 E:19
local trace_head_offset<const> = 4 -- T:25 H:23
local trace_frontier_offset<const> = 0x34 -- T:33 H:32
local cursor_bits<const> = 20 -- T:58 C:71
local cursor_mask<const> = (1 << cursor_bits) - 1 -- T:59 C:72
local mode_pending<const> = 4 << cursor_bits -- T:60 C:73
local table_kind<const> = 6 -- T:379 C:67-68,378
local closure_kind<const> = 7 -- T:381 C:380
local thread_kind<const> = 4 -- I:33 J:18
local upvalue_kind<const> = 11 -- U:11 V:13
local upvalue_flags<const> = 2 -- U:12 V:14
local upvalue_open<const> = 1 -- U:13 V:15

struct trace_quantum_state
	work: u32 -- T:528 C:546; work already credited by the owner of the phase
	limit: u32 -- T:528 C:546
	atomic: u32 -- T:528 C:546
	pending_string_work: u32 -- T:535 C:553 S:445-451 R:438-440; host latch transport
end

struct trace_frontier
	record: addr -- T:33,529 H:32 C:547
	cursor: u32 -- T:34,518 H:33 C:529
end

-- TS bounds kind through high RAM, then checks color before querying
-- issuance. C++ queries issuance first. Keep both gates in native order;
-- shared leaves preserve the corresponding mirror's color-byte store.
local admit_head<const> = function(arena, offset, address, replace_color_byte) -- T:378-389 C:375-387
	local kind = 0 -- T:379 C:377
	local lane<const>: *u8 = address -- T:379 C:377
	if replace_color_byte ~= 0 then -- T:379,386 C:377,384; explicit mirror selector
		if allocator.bmsx_dlmalloc_is_object(arena, offset - object_prefix) ~= 0 then kind = *lane end -- C:377 A:54 B:52 D:680-683
	elseif offset < arena - allocator_state_offset then -- T:379 A:25-26
		kind = *lane -- T:379
	end
	local table<const> = kind == table_kind -- T:380 C:378
	local cell = kind == upvalue_kind -- T:381 C:379
	if cell then -- T:381 C:379
		local flags<const>: *u8 = address + upvalue_flags -- T:381 C:379 U:25-26 W:28-29
		cell = (*flags & upvalue_open) == 0 -- T:381 C:379 U:25-26 W:28-29
	end
	local closure<const> = kind == closure_kind -- T:382 C:380
	local thread<const> = kind == thread_kind -- T:383 C:381
	if not table and not cell and not closure and not thread then return 0 end -- T:386-389 C:384-387
	local color<const>: *u8 = address + color_offset -- T:172,385 H:145 C:384
	if (*color & color_mask) ~= gray then return 0 end -- T:172,385 C:384 H:145
	if replace_color_byte == 0 and allocator.bmsx_dlmalloc_is_object(arena, offset - object_prefix) == 0 then return 0 end -- T:386-389 A:54 B:52 D:680-683
	return kind -- T:395-408 C:393-407
end

local trace_quantum<const> = function(control, arena, metadata, quantum, mode_key, replace_color_byte) -- T:528 C:546
	local state<const>: *trace_quantum_state = ram_base + quantum -- T:528 C:546
	local frontier<const>: *trace_frontier = ram_base + control + trace_frontier_offset -- T:529 C:547
	local head<const>: *u32 = ram_base + control + trace_head_offset -- T:534-535 C:551-553
	local work = state.work -- T:528 C:546
	local limit<const>, atomic<const> = state.limit, state.atomic -- T:528 C:546
	local pending = state.pending_string_work -- T:535 C:553 S:447-451 R:440
	local record = frontier.record -- T:529 C:547
	if record ~= 0 then -- T:530 C:547
		local cursor<const> = frontier.cursor -- T:517-518 C:528-529
		local lane<const>: *u8 = ram_base + (record & byte_mask) -- T:519 C:530 M:7
		local kind<const> = *lane -- T:519 C:530
		local added -- T:531 C:548
		local allowance<const> = limit - work -- T:531 C:548
		if kind == table_kind then -- T:520-521 C:531-536
			if cursor == mode_pending then -- T:520 C:532
				added, pending = table_head.trace_table(control, arena, metadata, record, mode_key, allowance, 1, pending, replace_color_byte) -- T:520 C:532
			else -- T:521 C:533
				local mode = cursor >> cursor_bits -- T:521 C:534
				if replace_color_byte ~= 0 then mode = mode & 0xff end -- T:521 C:534; native C++ narrows mode to u8
				added, pending = table_trace.trace_table_entries(control, arena, metadata, record, mode, cursor & cursor_mask, 0, allowance, pending, replace_color_byte) -- T:521 C:534-535
			end
		elseif kind == thread_kind then -- T:522 C:537
			added, pending = threads.trace_thread(control, arena, metadata, record, atomic, allowance, 1, pending, replace_color_byte) -- T:522-524 C:538-540
		else -- T:525 C:541
			local count<const> = capture.internal.capture_count(record) -- T:525 C:542
			added, pending = capture.internal.trace_captures(control, arena, metadata, record, cursor, count, 0, allowance, pending, replace_color_byte) -- T:525 C:542
		end
		work = work + added -- T:531 C:548
		if frontier.record ~= 0 then -- T:532 C:549
			state.pending_string_work = pending -- T:532 C:549 S:447-451 R:440; resume does not drain
			return work -- T:532 C:549
		end
	end
	-- The condition and trace() see the same RAM head, with no writer
	-- between their reads. Keep that sampled index for the traced record.
	local index = *head & gray_index_mask -- T:183,378,534 C:375,551 H:160
	while index ~= 0 and work < limit do -- T:377,534 C:374,551
		local offset<const> = index << record_shift -- T:378 C:375-376
		record = ram_base + offset -- T:378 C:376
		local kind<const> = admit_head(arena, offset, record, replace_color_byte) -- T:379-386 C:377-384
		local allowance<const> = limit - work -- T:535 C:552
		local added = 0 -- T:388 C:386
		if kind == 0 then -- T:386 C:384
			*head = 0 -- T:387 C:385; failed admission does not clock any link
		elseif kind == table_kind then -- T:395 C:393
			capture.internal.pop_admitted(control, record, false, replace_color_byte) -- T:390-394 C:388-392
			added, pending = table_head.trace_table(control, arena, metadata, record, mode_key, allowance, 0, pending, replace_color_byte) -- T:395 C:393
		elseif kind == thread_kind then -- T:408 C:407
			capture.internal.pop_admitted(control, record, false, replace_color_byte) -- T:390-394 C:388-392
			added, pending = threads.trace_thread(control, arena, metadata, record, atomic, allowance, 0, pending, replace_color_byte) -- T:408 C:407
		else -- T:396,400 C:394,398; only an admitted closed Upvalue or Closure
			added, pending = capture.trace_admitted(control, arena, metadata, record, kind, allowance, pending, replace_color_byte) -- T:390-406 C:388-405
		end
		work = work + added + pending -- T:535 C:552-553
		pending = 0 -- T:535 C:553 S:447-451 R:440; every new head drains the latch, including rejected heads
		index = *head & gray_index_mask -- T:183,534 C:551 H:160
	end
	state.pending_string_work = pending -- T:536 C:555 S:447-451 R:440; no head leaves the latch unconsumed
	return work -- T:536 C:555
end

return {
	trace_quantum = trace_quantum,
	internal = { admit_head = admit_head },
}
