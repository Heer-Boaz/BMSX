module<const>

-- Source basis: 491374c93f7ee18c547152916d8d109374b6a044.
-- T/C/H: GcHeap; A/D: Table storage; V/W: Value; O/P: object layout;
-- S/R: StringPool; M: RAM map.
local allocator<const> = require('kernel/dlmalloc') -- T:151 C:256
local marking<const> = require('kernel/gc_mark') -- T:310-319,540 C:259-265,297-298,561
local queues<const> = require('kernel/gc_control') -- T:551 C:574
local probe<const> = require('kernel/gc_table_mode') -- T:354-375,544-545 C:328-352,565-567
local mode_bits<const> = require('kernel/gc_weak_mode') -- T:344-352,375 C:315-325,343,346
local trace<const> = require('kernel/gc_table_trace') -- T:561-562,565-586 C:583-584,588-616
local ram_base<const> = 0x08000000 -- M:6
local record_mask<const> = 0x003ffff8 -- O:5-7 P:8-10 M:7
local object_prefix<const> = 8 -- O:5-6,9 P:8-9,13
local table_tag<const> = 6 -- T:154 C:68,285 V:9-11 W:21-22
local table_header_work<const> = 36 >> 2 -- T:541 A:52 C:562 D:43
local metatable_offset<const> = 8 -- A:34,122 D:27,195
local array_capacity_offset<const> = 16 -- A:34,132 D:27,57
local hash_count_offset<const> = 20 -- A:34,133 D:27,58
local trace_head_offset<const> = 4 -- T:25,313 H:23
local weak_visits_offset<const> = 28 -- T:29,551 C:574 H:28
local trace_record_offset<const> = 0x34 -- T:33,548,555 C:570,576 H:32
local mode_pending<const> = 4 << 20 -- T:57-60 C:69-73 O:12 P:17
local weak_values<const> = 2 -- T:554,558 C:67,575,580
local weak_keys<const> = 1 -- T:554 C:67,575

struct table_trace_frontier -- T:33-34 H:32-33
	record: addr -- T:548,555 C:570,576 H:32
	cursor: u32 -- T:548,555 C:570,576 H:33
end

-- The enclosing trace owns gray-head admission/pop/recolor. This routine
-- also takes the already-published Table owner of a pending mode probe.
-- Return collector work and a still-undrained String work latch separately.
local trace_table<const> = function(control, arena, metadata, address, mode_key, limit, resuming_mode, pending_string_work, replace_color_byte) -- T:538 C:558-559
	local metatable<const>: *u32 = address + metatable_offset -- T:539 A:120,122 C:560 D:195,240
	local meta<const> = *metatable -- T:539 C:560
	local resuming<const> = resuming_mode ~= 0 -- T:538,540-541 C:558,561-562
	if meta ~= 0 and not resuming then -- T:540 C:561
		marking.mark_record(control, arena, meta, table_tag, trace_head_offset, replace_color_byte) -- T:310-319,540 C:259-265,297-298,561
	end
	local work = resuming and 0 or table_header_work -- T:541 C:562
	local mode = 0 -- T:542 C:563
	local frontier<const>: *table_trace_frontier = ram_base + control + trace_record_offset -- T:548,555 C:570,576
	if meta ~= 0 or resuming then -- T:543 C:564
		local offset<const> = *metatable & record_mask -- T:148-149,153-154,355 A:120,122 C:253-254,284-285,329 D:195,240
		local kind<const>: *u8 = ram_base + offset -- T:150 C:255; also reads the raw public record projection
		local resolved = 0 -- T:151 C:256
		if *kind == table_tag and allocator.bmsx_dlmalloc_is_object(arena, offset - object_prefix) ~= 0 then -- T:150-151 C:255-256
			resolved = ram_base + offset -- T:151 C:256
		end
		local allowance<const> = work < limit and limit - work or 0 -- T:544 C:565
		local pending<const>, tag<const>, payload<const>, inspected<const> = probe.probe_table_mode(control, resolved, mode_key, allowance) -- T:354-375,544-545 C:328-352,565-567
		work = work + inspected -- T:545 C:567
		if pending ~= 0 then -- T:547 C:569
			frontier.record = address -- T:548 C:570
			frontier.cursor = mode_pending -- T:548 C:570
			return work, pending_string_work -- T:549,535 C:571,553 S:448-451 R:441
		end
		mode = mode_bits.weak_mode_bits(tag, payload) -- T:344-352,375 C:315-325,343,346,566; terminal raw Value, no String work
	end
	if mode ~= 0 then queues.append_visit(control, weak_visits_offset, address) end -- T:551 C:573-574
	if mode == (weak_keys | weak_values) then -- T:554 C:575
		if resuming then -- T:555 C:576
			frontier.record = 0 -- T:555 C:576
			frontier.cursor = 0 -- T:555 C:576
		end
		return work, pending_string_work -- T:556,535 C:577,553 S:448-451 R:441
	end
	local array_field<const>: *u32 = address + array_capacity_offset -- T:559-560 A:120,132,1154 C:581-582 D:57,148,240
	local hash_field<const>: *u32 = address + hash_count_offset -- T:560 A:120,133,1154 C:582 D:58,148,240
	local array<const>, hash<const> = *array_field, *hash_field -- T:559-560 A:1154 C:581-582 D:148
	local skips_array<const> = (mode & weak_values) ~= 0 -- T:558 C:580
	local first<const> = skips_array and array or 0 -- T:559 C:581
	local slots<const> = skips_array and 2 * hash or array + 2 * hash -- T:560 A:1154 C:582 D:148
	if resuming or work + slots * 2 > limit then -- T:561 C:583
		local credited<const>, pending<const> = trace.trace_table_entries(control, arena, metadata, address, mode, first, work, limit, pending_string_work, replace_color_byte) -- T:561 C:583
		return credited, pending -- T:561 C:583
	end
	local marked<const> = trace.trace_table_edges(control, arena, metadata, address, mode, first, -1, replace_color_byte) -- T:562,565 C:584,588 D:150; unsigned end includes the entire extent
	return work + slots, pending_string_work + marked -- T:563,535 C:585,553 S:446,448-451 R:439,441
end

return { trace_table = trace_table }
