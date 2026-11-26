module<const>

-- Source basis: a9b0bb5ff98c539822013063a3ef557809464f28.
-- T/C/H: GcHeap; A/D: Table storage; S/R: StringPool; V/W: Value;
-- O/P: GC object fields; M: RAM map.
local mark<const> = require('kernel/gc_mark') -- T:97-99,331-339 C:77-92,591,594,597 H:121
local ram_base<const> = 0x08000000 -- M:6
local ram_word_mask<const> = 0x003ffffc -- M:7-9
local nil_tag<const> = 0 -- V:8-11 W:20-22,56
local weak_keys<const> = 1 -- T:568 C:67,593
local weak_values<const> = 2 -- T:569 C:67,596
local hash_storage_offset<const> = 12 -- A:34 D:27
local array_capacity_offset<const> = 16 -- A:34 D:27
local hash_size_offset<const> = 20 -- A:34 D:27
local array_storage_offset<const> = 32 -- A:34 D:27
local trace_head_offset<const> = 4 -- T:25,313 H:23,121
local trace_record_offset<const> = 0x34 -- T:33 C:614 H:32
local trace_cursor_bits<const> = 20 -- T:57-58 C:69-71 O:12 P:17
local sign_bit<const> = 0x80000000 -- A:1155,1158,1160 D:150,154,158; unsigned end ordering

struct table_trace_frontier -- T:33-34 H:32-33
	record: addr -- T:584 C:614 H:32
	cursor: u32 -- T:585 C:615 H:33
end

-- One bounded physical range; Table head admission and mode resolution
-- are owned by the caller. The existing marker owns the record-port
-- projection and the TS/C++ color store selector for each edge.
local trace_table_edges<const> = function(control, arena, metadata, table, mode, first, last, replace_color_byte) -- T:565 C:588 A:1155-1156 D:150
	local keys<const> = mode == 0 or mode == weak_values -- T:97-98,566-569 C:589-592,596-598
	local values<const> = mode == 0 or mode == weak_keys -- T:97,99,566-569 C:589-595
	if not keys and not values then return 0 end -- T:566-570 C:589-599; no visitor for other mode inputs
	local array_field<const>: *u32 = table + array_capacity_offset -- A:132,1157 D:57,151,240
	local hash_field<const>: *u32 = table + hash_size_offset -- A:133,1157 D:58,151,240
	local hash_storage<const>: *u32 = table + hash_storage_offset -- A:137,1157 D:55,153,300-304
	local array<const>, hash<const> = *array_field, *hash_field -- A:1157 D:151
	local words<const>: *u32 = ram_base + (*hash_storage & ram_word_mask) -- A:1157 D:153,305
	local tags<const>: *u8 = words + 8 * hash -- A:1158 D:153,306
	local total<const> = array + hash -- A:1158 D:158
	local stop<const> = (last ~ sign_bit) < (total ~ sign_bit) and last or total -- A:1158 D:158
	local array_storage<const>: *u32 = table + array_storage_offset -- A:136,1159 D:56,152,331
	local array_words<const>: *u32 = ram_base + (*array_storage & ram_word_mask) -- A:1159 D:152,331
	local array_tags<const>: *u8 = array_words + 4 * array -- A:1159 D:152,332
	local array_end<const> = (last ~ sign_bit) < (array ~ sign_bit) and last or array -- A:1160 D:154
	local string_work = 0 -- T:574,581 C:611 S:446,448-451 R:439,441
	for slot = first, array_end - 1 do -- A:1161 D:154
		local tag<const> = array_tags[slot] -- A:1162 D:155,248-249
		if tag ~= nil_tag then -- A:1163 D:156
			local word<const> = array_words[slot] -- A:1163 D:155,248-249
			-- The generated key is Integer(slot + 1), a non-edge in
			-- markValue. Only the explicit value can add marking work.
			if values then -- T:97-99,331-339,567-569 C:90-91,591,594,597 A:1163 D:156
				local _<const>, added<const> = mark.mark_value(control, arena, metadata, tag, word, trace_head_offset, replace_color_byte) -- T:97,99,567-568 C:591,594 H:121 A:1163 D:156
				string_work = string_work + added -- T:336,581 C:88,611 S:446 R:439; the object boolean is not work here
			end
		end
	end
	local hash_first<const> = first > array and first - array or 0 -- A:1165 D:158-159
	for key = hash_first, stop - array - 1 do -- A:1165 D:158
		local value<const> = key + hash -- A:1166 D:161
		local kt<const>, vt<const> = tags[key], tags[value] -- A:1167 D:159,161,248-249
		if kt ~= nil_tag and vt ~= nil_tag then -- A:1168 D:160,162
			local kw<const>, vw<const> = words[key], words[value] -- A:1169-1170 D:159,161-162,248-249
			if keys then -- T:97-98,567,569 C:591,597
				local _<const>, added<const> = mark.mark_value(control, arena, metadata, kt, kw, trace_head_offset, replace_color_byte) -- T:97-98,567,569 C:591,597 H:121 A:1169 D:162
				string_work = string_work + added -- T:336,581 C:88,611 S:446 R:439
			end
			if values then -- T:97,99,567-568 C:591,594
				local _<const>, added<const> = mark.mark_value(control, arena, metadata, vt, vw, trace_head_offset, replace_color_byte) -- T:97,99,567-568 C:591,594 H:121 A:1170 D:162
				string_work = string_work + added -- T:336,581 C:88,611 S:446 R:439
			end
		end
	end
	return string_work -- T:581 C:611 S:446,448-451 R:439,441; explicit mark delta for the caller
end

-- next is a decoded physical slot index (array then hash). Work and limit
-- are the collector's bounded nonnegative quantum counts. If no span runs,
-- the outer quantum retains its already accumulated String mark credit.
local trace_table_entries<const> = function(control, arena, metadata, table, mode, next, work, limit, pending_string_work, replace_color_byte) -- T:572 C:602
	local array_field<const>: *u32 = table + array_capacity_offset -- T:573 C:603 A:132 D:57,240
	local hash_field<const>: *u32 = table + hash_size_offset -- T:573 C:603 A:133 D:58,240
	local array<const> = *array_field -- T:573 C:603
	local last<const> = array + *hash_field -- T:573 C:603 A:1142 D:144
	while next < last and work < limit do -- T:575 C:604
		local array_entry<const> = next < array -- T:576 C:605
		local entry_words<const> = array_entry and 1 or 2 -- T:576 C:606
		local worst<const> = 2 * entry_words -- T:577 C:607
		local span<const> = (limit - work) // worst -- T:578 C:608; integer division inside a positive budget
		local boundary<const> = array_entry and array or last -- T:579 C:609
		local candidate<const> = next + (span > 1 and span or 1) -- T:578-579 C:608-609
		local stop<const> = candidate < boundary and candidate or boundary -- T:579 C:609
		local marked<const> = trace_table_edges(control, arena, metadata, table, mode, next, stop, replace_color_byte) -- T:580 C:610
		work = work + (stop - next) * entry_words + pending_string_work + marked -- T:581 C:611 S:448-451 R:441
		pending_string_work = 0 -- T:574,581 C:611 S:450 R:441; takeMarkWork drains only here
		next = stop -- T:582 C:612
	end
	local frontier<const>: *table_trace_frontier = ram_base + control + trace_record_offset -- T:584-585 C:614-615
	local deferred<const> = next < last -- T:584-585 C:614-615
	frontier.record = deferred and table or 0 -- T:584 C:614
	frontier.cursor = deferred and ((mode << trace_cursor_bits) | next) or 0 -- T:585 C:615
	return work, pending_string_work -- T:586 C:616 S:448-451 R:441; preserve undrained credit if no span ran
end

return {
	trace_table_edges = trace_table_edges,
	trace_table_entries = trace_table_entries,
}
