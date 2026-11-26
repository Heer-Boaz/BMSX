module<const>

-- Source basis: 6a580740492a6ebdaca200fc90e243ebbcdcd230.
-- T/C/H: GcHeap; A/D: Table storage; O/P: object layout; S/R: StringPool;
-- V/W: Value; M: RAM map. This is the weak-clear quantum only,
-- not the enclosing atomic transition or pacing.
local allocator<const> = require('kernel/dlmalloc') -- T:151 C:256
local queues<const> = require('kernel/gc_control') -- T:182,248-253,273-274,288,719 C:171-176,198-199,216,767 H:160
local probe<const> = require('kernel/gc_table_mode') -- T:354-375,726-727 C:328-352,777-778
local mode_bits<const> = require('kernel/gc_weak_mode') -- T:344-352,375 C:315-325,343,346
local weak_entries<const> = require('kernel/gc_weak_table') -- T:100-117,737 C:355-371,789-790 A:1173-1199 D:165-190
local ram_base<const> = 0x08000000 -- T:277 C:202 M:6
local table_tag<const> = 6 -- T:154,720 C:68,285,768 V:9-11 W:21-22
local object_prefix<const> = 8 -- T:151 C:256 O:5-6,9 P:8-9,13
local record_mask<const> = 0x003ffff8 -- T:149 C:254 O:5-7 P:8-10 M:7
local record_shift<const> = 3 -- T:277 C:202 O:5 P:8
local record_link_offset<const> = 4 -- T:286 C:214 O:8 P:15
local gray_index_bits<const> = 19 -- T:286 C:214 O:12 P:17
local visit_link_low_bits<const> = 32 - gray_index_bits -- T:66,287 C:168,215
local visit_link_high_mask<const> = ((1 << gray_index_bits) - 1) >> visit_link_low_bits -- T:67,287 C:169,215
local visit_header_offset<const> = 3 -- T:64,278 C:203 H:61
local visit_member<const> = 0x40 -- T:65,280,288 C:205,216 H:62
local weak_visits_offset<const> = 28 -- T:29,719-720 C:767-768 H:28
local visit_count_offset<const> = 8 -- T:31,274 C:199,223 H:30
local trace_record_offset<const> = 0x34 -- T:33,305,717 C:765,770 H:32
local trace_cursor_bits<const> = gray_index_bits + 1 -- T:57-58 C:69-71
local trace_cursor_mask<const> = (1 << trace_cursor_bits) - 1 -- T:59,733 C:72,784
local mode_pending<const> = 4 << trace_cursor_bits -- T:60,305,725 C:73,770,776
local table_metatable_offset<const> = 8 -- T:355 C:329 A:34,122 D:27,195
local array_capacity_offset<const> = 16 -- T:732 C:783 A:34 D:27
local hash_count_offset<const> = 20 -- T:732 C:783 A:34 D:27

struct weak_visit_list -- T:27-31 H:25-30
	head: u32 -- T:293-294 C:221-222
	tail: u32 -- T:30,293 C:221 H:29
	count: u32 -- T:31,295 C:223 H:30
end

struct weak_trace_frontier -- T:33-34 H:32-33
	record: addr -- T:305,717,741 C:765,770,794
	cursor: u32 -- T:305,724,742 C:770,775,795
end

-- Same pinned context as trace_quantum (HeapServiceTraceField). The
-- trailing MirrorPolicy at +16 is host-owned; the selector is an argument.
struct weak_quantum_state -- T:703 C:748; private trace quantum transport
	work: u32 -- T:703 C:748; Work +0, prefix already credited
	limit: u32 -- T:703 C:748; Limit +4
	atomic: u32 -- T:703 C:748; Atomic +8, unused by the weak phase
	pending_string_work: u32 -- T:738,744 C:791,797 S:448-451 R:441; PendingStringWork +12
end

local table_record_address<const> = function(arena, reference) -- T:148,153-154,281,355 C:253,284-285,207,329
	local offset<const> = reference & record_mask -- T:149 C:254
	local header<const>: *u8 = ram_base + offset -- T:150 C:255; raw record port, not the public bus
	if *header == table_tag and allocator.bmsx_dlmalloc_is_object(arena, offset - object_prefix) ~= 0 then -- T:150-151 C:255-256
		return ram_base + offset -- T:151 C:256
	end
	return 0 -- T:151 C:256
end

-- visitList's one-item Table/Drain specialization. Its visitor publishes
-- the trace pair before the list's own head/tail/count are written back.
local detach_weak_visit<const> = function(control, arena, frontier_address, index) -- T:270-273,720 C:195-198,768-771
	local list<const>: *weak_visit_list = ram_base + control + weak_visits_offset -- T:293-295 C:221-223
	local frontier<const>: *weak_trace_frontier = frontier_address -- T:305,720 C:770
	local remaining = queues.internal.index_word(control, weak_visits_offset + visit_count_offset) -- T:274 C:199 H:160
	local visits = 0 -- T:275 C:200
	while index ~= 0 and remaining ~= 0 and visits < 1 do -- T:276,720 C:201,771
		local address<const> = ram_base + (index << record_shift) -- T:277 C:202
		local header<const>: *u8 = address + visit_header_offset -- T:278 C:203
		local meta<const> = *header -- T:278 C:203
		if (meta & visit_member) == 0 or table_record_address(arena, address) ~= address then -- T:280-281 C:205-207; validate membership before touching kind
			index = 0 -- T:282 C:205,207
			break -- T:282 C:205,207
		end
		remaining = remaining - 1 -- T:284 C:212
		visits = visits + 1 -- T:285 C:213
		local link<const>: *u32 = address + record_link_offset -- T:286 C:214
		local low<const> = *link >> gray_index_bits -- T:286 C:214
		index = low | ((meta & visit_link_high_mask) << visit_link_low_bits) -- T:287 C:215
		queues.internal.set_visit_link(address, meta & ~visit_member, 0) -- T:248-253,288 C:171-176,216
		frontier.record = address -- T:289,304-305 C:217,769-770
		frontier.cursor = mode_pending -- T:289,305 C:217,770
	end
	if index == 0 or remaining == 0 then index, remaining = 0, 0 end -- T:291 C:219
	if index == 0 then -- T:292-293 C:220-221
		list.head = 0 -- T:293 C:221
		list.tail = 0 -- T:293 C:221
	else -- T:294 C:222
		list.head = index -- T:294 C:222
	end
	list.count = remaining -- T:295 C:223
	return visits -- T:299 C:228
end

-- The native String mark latch drains only when an entry span has run.
-- Any previously earned credit remaining at retirement goes back to its
-- enclosing quantum. narrow_saved_mode selects the native C++ u8 cast
-- rather than the TS raw 12-bit mode when republishing a saved cursor.
local clear_weak_quantum<const> = function(control, arena, metadata, mode_key, new_index, limit, pending_string_work, narrow_saved_mode) -- T:713-715 C:759,763; timing instrumentation stays with the host
	local frontier<const>: *weak_trace_frontier = ram_base + control + trace_record_offset -- T:717,724,741-742 C:765,775,794-795
	local work = 0 -- T:715 C:763
	while work < limit do -- T:716 C:764
		local record = frontier.record -- T:717 C:765
		if record == 0 then -- T:718 C:766
			local index<const> = queues.internal.index_word(control, weak_visits_offset) -- T:719 C:767 H:160
			if index == 0 then break end -- T:719 C:767
			work = work + detach_weak_visit(control, arena, frontier, index) -- T:720 C:768-771
			record = frontier.record -- T:721 C:769-770; TS rereads the published pair, C++ keeps the visitor's local
			if record == 0 or work == limit then break end -- T:722 C:772
		end
		local cursor = frontier.cursor -- T:724 C:774-775
		if cursor == mode_pending then -- T:725 C:776
			local field<const>: *u32 = record + table_metatable_offset -- T:355,726 C:329,777 A:120,122 D:195,240
			local meta<const> = table_record_address(arena, *field) -- T:355,726 C:329,777
			local pending<const>, tag<const>, payload<const>, inspected<const> = probe.probe_table_mode(control, meta, mode_key, limit - work) -- T:354-375,726-727 C:328-352,777-778
			work = work + inspected -- T:727 C:778
			if pending ~= 0 then break end -- T:728 C:779
			cursor = mode_bits.weak_mode_bits(tag, payload) << trace_cursor_bits -- T:344-352,375,729 C:315-325,343,346,780
		end
		local mode = cursor >> trace_cursor_bits -- T:731 C:782
		if narrow_saved_mode ~= 0 then mode = mode & 0xff end -- T:731 C:782; preserve the raw mirror distinction
		local array_word<const>: *u32 = record + array_capacity_offset -- T:732 A:132 C:783 D:57,240
		local hash_word<const>: *u32 = record + hash_count_offset -- T:732 A:133 C:783 D:58,240
		local array<const> = *array_word -- T:732 C:783
		local last<const> = array + *hash_word -- T:732 A:1142 C:783 D:144
		local next = cursor & trace_cursor_mask -- T:733 C:784
		while next < last and work < limit do -- T:734 C:785
			local array_entry<const> = next < array -- T:735-736 C:786-787
			local entry_words<const> = array_entry and 1 or 2 -- T:735 C:786
			local width<const> = (limit - work) // (2 * entry_words) -- T:736 C:788
			local span<const> = width > 1 and width or 1 -- T:736 C:788
			local boundary<const> = array_entry and array or last -- T:736 C:787
			local candidate<const> = next + span -- T:736 C:788
			local stop<const> = candidate < boundary and candidate or boundary -- T:736 C:787-788
			local marked<const> = weak_entries.clear_weak_entries(control, arena, metadata, record, mode, next, stop, new_index) -- T:737 C:789-790; leaf consumes only weak bits 0/1
			work = work + (stop - next) * entry_words + pending_string_work + marked -- T:738 C:791 S:446,448-451 R:439,441
			pending_string_work = 0 -- T:738 C:791 S:450 R:441
			next = stop -- T:739 C:792
		end
		local deferred<const> = next < last -- T:741-742 C:794-795
		frontier.record = deferred and record or 0 -- T:741 C:794
		frontier.cursor = deferred and ((mode << trace_cursor_bits) | next) or 0 -- T:742 C:795
	end
	return work, pending_string_work -- T:744 C:797 S:448-451 R:441
end

local clear_weak_step<const> = function(control, arena, metadata, quantum, mode_key, new_index, narrow_saved_mode) -- T:703 C:748; pinned CPU entry
	local state<const>: *weak_quantum_state = ram_base + quantum -- T:703,738 C:748,791; RAM context instead of host locals
	local prefix<const> = state.work -- T:703 C:748
	local work<const>, pending<const> = clear_weak_quantum(control, arena, metadata, mode_key, new_index, state.limit - prefix, state.pending_string_work, narrow_saved_mode) -- T:703,738 C:748,791
	state.pending_string_work = pending -- T:738,744 C:791,797 S:448-451 R:441
	return prefix + work -- T:703-704 C:748-749
end

return {
	internal = { table_record_address = table_record_address, detach_weak_visit = detach_weak_visit },
	clear_weak_quantum = clear_weak_quantum,
	clear_weak_step = clear_weak_step,
}
