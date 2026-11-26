module<const>

-- Source basis: 61e40427ed56ea18e7fad271ef3afa1735b9ba9e.
-- T/C/H are the collector; O/P the object words; U/V/W the Upvalue
-- owners; L/B/D the Closure owners; I/J the Thread backing; M RAM decode.
-- The caller admits a gray Closure or closed Upvalue before entering
-- trace_admitted. The trace-head eligibility, Table/Thread dispatch,
-- and the surrounding quantum belong to gc_trace.
-- Record and stack aliases supplied to the private service lie in its RAM
-- aperture. Preserve kind-before-issuance for capture cell references here;
-- the caller still owns decode of public raw aliases.
local allocator<const> = require('kernel/dlmalloc') -- T:150-151 C:255-256
local mark<const> = require('kernel/gc_mark') -- T:322-325,394,397 C:302-305,392,395
local ram_base<const> = 0x08000000 -- M:6
local word_mask<const> = 0x003ffffc -- M:9
local byte_mask<const> = 0x003fffff -- M:7
local record_mask<const> = 0x003ffff8 -- O:5-7 P:8-10
local object_prefix<const> = 8 -- O:5-6,9 P:8-9,13
local record_link<const> = 4 -- O:8 P:15
local gray_index_bits<const> = 19 -- O:12 P:17
local gray_index_mask<const> = (1 << gray_index_bits) - 1 -- O:13 P:18
local capture_count_high_byte<const> = 3 -- L:37 B:56
local capture_count_low_bits<const> = 32 - gray_index_bits -- L:38 B:57
local capture_words<const> = 12 -- L:40 B:59
local trace_head_offset<const> = 4 -- T:25 H:22
local trace_record_offset<const> = 0x34 -- T:33 H:31
local upvalue_kind<const> = 11 -- U:11 V:13
local upvalue_open_bit<const> = 1 -- U:13 V:15
local upvalue_next_offset<const> = 12 -- U:17 V:19
local upvalue_work<const> = 16 >> 2 -- U:9 V:11 T:326,398 C:306,396
local color_black<const> = 3 -- T:323,394 C:303,392
local thread_kind<const> = 4 -- I:33 J:18
local thread_stack_block<const> = 24 -- I:22 J:21
local thread_stack_capacity<const> = 28 -- I:22 J:21
local sign_bit<const> = 0x80000000 -- T:507,514 C:517,524; unsigned cursor comparison

struct capture_cell
	kind: u8 -- U:11,20-21 V:13 W:23-24
	color: u8 -- O:3 P:6
	flags: u8 -- U:12 V:14
	tag: u8 -- U:14 V:16
	word: u32 -- U:15 V:17
	owner: addr -- U:16 V:18
	next: u32 -- U:17 V:19
end

struct capture_frontier
	record: addr -- T:33 H:31
	cursor: u32 -- T:34 H:32
end

local cell_record_address<const> = function(arena, reference) -- T:148-151,156-157 C:253-256,288-289
	local offset<const> = reference & record_mask -- T:149 C:254
	local cell<const>: *capture_cell = ram_base + offset -- T:150 C:255
	if cell.kind ~= upvalue_kind then return 0 end -- T:150,157 C:255,289
	if allocator.bmsx_dlmalloc_is_object(arena, offset - object_prefix) == 0 then return 0 end -- T:151 C:256
	return ram_base + offset -- T:151 C:256
end

local load_upvalue<const> = function(address) -- U:53 W:56
	local cell<const>: *capture_cell = ram_base + (address & record_mask) -- U:54 W:57
	local word<const> = cell.word -- U:55 W:58
	if (cell.flags & upvalue_open_bit) == 0 then -- U:25-26,56 W:28-29,59
		return cell.tag, word -- U:56 W:60
	end
	local owner<const> = cell.owner -- U:57 W:15-16,61
	local block_word<const>: *u32 = ram_base + ((owner + thread_stack_block) & word_mask) -- U:58 W:17
	local block<const> = *block_word & word_mask -- U:58 W:17
	local capacity_word<const>: *u32 = ram_base + ((owner + thread_stack_capacity) & word_mask) -- U:59 W:18
	local capacity<const> = *capacity_word -- U:59 W:18
	local tag<const>: *u8 = ram_base + ((block + capacity * 4 + word) & byte_mask) -- U:60 W:19,62
	local payload<const>: *u32 = ram_base + ((block + word * 4) & word_mask) -- U:60 W:19,62
	return *tag, *payload -- U:60 W:62; both C++ argument reads are side-effect free
end

local mark_cell<const> = function(control, arena, metadata, cell, replace_color_byte) -- T:321 C:301
	if cell == 0 then return 0, 0 end -- T:322 C:302
	local record<const>: *capture_cell = ram_base + (cell & record_mask) -- T:322-324 C:302-304
	if not mark.internal.unmarked(control, record.color) then return 0, 0 end -- T:322 C:302
	mark.internal.set_color(cell, color_black, replace_color_byte) -- T:323 C:303
	if (record.flags & upvalue_open_bit) ~= 0 then -- T:324 U:25-26 C:304 W:28-29
		mark.mark_record(control, arena, record.owner, thread_kind, trace_head_offset, replace_color_byte) -- T:306-307,324 C:272-273,304
	end
	local tag<const>, word<const> = load_upvalue(cell) -- T:325 C:305
	local _<const>, string_work<const> = mark.mark_value(control, arena, metadata, tag, word, trace_head_offset, replace_color_byte) -- T:325 C:305
	return upvalue_work, string_work -- T:326 C:306; the old String mark latch is returned separately
end

local capture_count<const> = function(closure) -- L:50 D:68
	local low_word<const>: *u32 = ram_base + ((closure + record_link) & word_mask) -- L:51 D:69
	local low<const> = *low_word >> gray_index_bits -- L:51 D:69
	local high_byte<const>: *u8 = ram_base + ((closure + capture_count_high_byte) & byte_mask) -- L:52 D:70
	local high<const> = *high_byte & 0x7f -- L:52 D:70
	return low | (high << capture_count_low_bits) -- L:53 D:71
end

local capture_address<const> = function(closure, index) -- L:55 D:74
	local word<const>: *u32 = ram_base + ((closure + capture_words + index * 4) & word_mask) -- L:56 B:85-86 D:75
	return *word -- L:56 D:75
end

-- The native pending String latch is transport, not a new unit of collector
-- work. This slow path bills it after a capture; a zero-visit call returns it.
local trace_captures<const> = function(control, arena, metadata, closure, next_index, count, work, limit, pending_string_work, replace_color_byte) -- T:505-506 C:516
	while (next_index ~ sign_bit) < (count ~ sign_bit) and work < limit do -- T:507 C:517
		local reference<const> = capture_address(closure, next_index) -- T:508 C:518
		next_index = next_index + 1 -- T:508 C:518
		local cell<const> = cell_record_address(arena, reference) -- T:508 C:518
		local cell_work<const>, string_work<const> = mark_cell(control, arena, metadata, cell, replace_color_byte) -- T:508 C:518
		work = work + 1 + cell_work -- T:508 C:518
		work = work + pending_string_work + string_work -- T:509 C:519
		pending_string_work = 0 -- T:509 C:519; takeMarkWork clears the native latch
	end
	local frontier<const>: *capture_frontier = ram_base + control + trace_record_offset -- T:513 C:523
	if (next_index ~ sign_bit) < (count ~ sign_bit) then -- T:514 C:524
		frontier.record = closure -- T:513-514 C:523-524
		frontier.cursor = next_index -- T:513-514 C:523-524
	else -- T:514 C:524
		frontier.record = 0 -- T:513-514 C:523-524
		frontier.cursor = 0 -- T:513-514 C:523-524
	end
	return work, pending_string_work -- T:515 C:525
end

local resume_captures<const> = function(control, arena, metadata, closure, limit, pending_string_work, replace_color_byte) -- T:517,525 C:528,542
	local frontier<const>: *capture_frontier = ram_base + control + trace_record_offset -- T:518 C:529
	local cursor<const> = frontier.cursor -- T:518 C:529
	local count<const> = capture_count(closure) -- T:525 C:542
	local work<const>, pending<const> = trace_captures(control, arena, metadata, closure, cursor, count, 0, limit, pending_string_work, replace_color_byte) -- T:525 C:542
	return work, pending -- T:525 C:542
end

local pop_admitted<const> = function(control, address, cell, replace_color_byte) -- T:390-394 C:388-392
	local offset<const> = cell and upvalue_next_offset or record_link -- T:390 C:388
	local link<const>: *u32 = ram_base + ((address + offset) & word_mask) -- T:390-391 C:388-389
	local packed<const> = *link -- T:391 C:389
	local head<const>: *u32 = ram_base + control + trace_head_offset -- T:392 C:390
	*head = packed & gray_index_mask -- T:392 C:390
	if cell then *link = 0 else *link = packed & ~gray_index_mask end -- T:393 C:391
	mark.internal.set_color(address, color_black, replace_color_byte) -- T:394 C:392
end

local trace_admitted<const> = function(control, arena, metadata, address, kind, limit, pending_string_work, replace_color_byte) -- T:377,381-382 C:374,379-380; source dispatch admits this head
	local cell<const> = kind == upvalue_kind -- T:381 C:379; only admitted closed cells reach here
	pop_admitted(control, address, cell, replace_color_byte) -- T:390-394 C:388-392
	if cell then -- T:396 C:394
		local tag<const>, word<const> = load_upvalue(address) -- T:397 C:395
		local _<const>, string_work<const> = mark.mark_value(control, arena, metadata, tag, word, trace_head_offset, replace_color_byte) -- T:397 C:395
		return upvalue_work, pending_string_work + string_work -- T:398,535 C:396,553
	end
	local count<const> = capture_count(address) -- T:400-401 C:398-399; remaining admitted kind is Closure
	if 3 + 6 * count > limit then -- T:403 C:401
		local work<const>, pending<const> = trace_captures(control, arena, metadata, address, 0, count, 3, limit, pending_string_work, replace_color_byte) -- T:403 C:401
		return work, pending -- T:403 C:401
	end
	local work = 3 + count -- T:404 C:402
	local index = 0 -- T:405 C:403
	while index < count do -- T:405 C:403
		local reference<const> = capture_address(address, index) -- T:405 C:404
		local capture<const> = cell_record_address(arena, reference) -- T:405 C:404
		local cell_work<const>, string_work<const> = mark_cell(control, arena, metadata, capture, replace_color_byte) -- T:405 C:404
		work = work + cell_work -- T:405 C:404
		pending_string_work = pending_string_work + string_work -- T:405,535 C:404,553; charged by the outer trace quantum
		index = index + 1 -- T:405 C:403
	end
	return work, pending_string_work -- T:406,535 C:405,553
end

return {
	internal = {
		cell_record_address = cell_record_address, load_upvalue = load_upvalue,
		capture_count = capture_count, capture_address = capture_address, trace_captures = trace_captures,
		pop_admitted = pop_admitted,
	},
	mark_cell = mark_cell,
	trace_admitted = trace_admitted,
	resume_captures = resume_captures,
}
