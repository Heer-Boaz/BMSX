module<const>

-- Source basis: df704905d4b791f9e06a37fd1aa71ea3c143152b.
-- T is gc_heap.ts, C is gc_heap.cpp, H its header;
-- O is gc_object.ts and P is gc_object.h. M/N are the record ports in
-- memory.ts/memory.h, and S is the TS memory_map.ts numeric specification.
-- This slice uses mapped RAM for comparison. Production must use the record
-- port, with the mutator excluded until each operation returns. Two-word
-- writes are ordered stores here, not a request to change their native extent.
local ram_base<const> = 0x08000000 -- S:6 M:288-305 N:67-82
local ram_byte_mask<const> = 0x003fffff -- M:311-317 N:84-88
local ram_word_mask<const> = 0x003ffffc -- M:289-302 N:68-78
local gc_record_mask<const> = 0x003ffff8 -- S:7 O:5-7 P:8-10
local gc_record_shift<const> = 3 -- O:5 P:8
local gc_record_link<const> = 4 -- O:8 P:15
local gc_object_link_before<const> = 4 -- O:10 P:14
local gc_gray_index_bits<const> = 19 -- O:12 P:17
local gc_gray_index_mask<const> = (1 << gc_gray_index_bits) - 1 -- O:13 P:18
local gc_visit_header_byte<const> = 3 -- T:60 H:61
local gc_visit_member<const> = 0x40 -- T:61 H:62
local visit_link_low_bits<const> = 32 - gc_gray_index_bits -- T:62 C:168
local visit_link_high_mask<const> = gc_gray_index_mask >> visit_link_low_bits -- T:63 C:169
local pause<const> = 0 -- T:64 H:18

struct gc_visit_list
	head: u32 -- T:24-25 H:26-27
	tail: u32 -- T:26 H:28
	count: u32 -- T:27 H:29
end

struct gc_control
	phase: u8 -- T:83-85 H:90
	white: u8 -- T:86 H:91
	reserved_low: u8[2] -- T:21,85-86 H:22,90-91
	trace_head: u32 -- T:21 H:22
	changed_head: u32 -- T:22 H:23
	thread_visits: gc_visit_list -- T:24 H:26
	reserved_between_visits: u32 -- T:24-27 H:26-29
	weak_visits: gc_visit_list -- T:25 H:27
	reserved_before_trace: u32[3] -- T:25-29 H:27-31
	trace_record: addr -- T:29 H:31
	trace_cursor: u32 -- T:30 H:32
	thread_trace_open: addr -- T:31 H:33
	thread_trace_top: u32 -- T:32 H:34
	remark_visit_index: u32 -- T:34 H:36
	remark_visit_state: u32 -- T:35 H:37
	mode_meta: addr -- T:36 H:38
	mode_node: i32 -- T:37 H:39
	mode_remaining: u32 -- T:38 H:40
	root_cursor: u32 -- T:39 H:41
	epoch_work: u32 -- T:40 H:42
	last_epoch_work: u32 -- T:41 H:43
	physical_occupied_at_tick: u32 -- T:42 H:44
	physical_assist: u32 -- T:43 H:45
	object_head: addr -- T:44 H:46
	object_count: u32 -- T:45 H:47
	sweep_link: addr -- T:46 H:48
end

rodata gc_phase_selector: u8[8] = { 0, 1, 2, 3, 4, 5, 0, 0 } -- T:64,66-68 H:18,82-84

local decode_gc_phase<const> = function(word) -- T:69 H:81
	return gc_phase_selector[word & 7] -- T:70 H:85
end

local phase<const> = function(control) -- T:83 H:90
	local state<const>: *gc_control = ram_base + control -- T:84 H:90; map the record-port offset
	return decode_gc_phase(state.phase) -- T:84 H:90
end

local active<const> = function(control) -- T:155 H:92
	return phase(control) ~= pause -- T:155 H:92
end

local index_word<const> = function(control, queue) -- T:169 H:155
	local index<const>: *u32 = ram_base + control + queue -- T:169 H:155; map the record-port offset
	return *index & gc_gray_index_mask -- T:169 H:155
end

local set_visit_link<const> = function(address, meta, index) -- T:234 C:171
	local link<const>: *u32 = ram_base + ((address + gc_record_link) & ram_word_mask) -- T:235-236 C:172-173
	local header<const>: *u8 = ram_base + ((address + gc_visit_header_byte) & ram_byte_mask) -- T:237 C:174
	local gray<const> = *link & gc_gray_index_mask -- T:235 C:172
	*link = gray | (index << gc_gray_index_bits) -- T:236 C:173
	*header = (meta & ~visit_link_high_mask) | (index >> visit_link_low_bits) -- T:237-238 C:174-175
end

local append_visit<const> = function(control, list, address) -- T:240 C:178
	local header<const>: *u8 = ram_base + ((address + gc_visit_header_byte) & ram_byte_mask) -- T:241 C:179
	local meta<const> = *header -- T:241 C:179
	if (meta & gc_visit_member) ~= 0 then return end -- T:242 C:180
	local index<const> = (address & gc_record_mask) >> gc_record_shift -- T:243 C:181
	local tail<const> = index_word(control, list + offsetof(gc_visit_list.tail)) -- T:244 C:182
	set_visit_link(address, meta | gc_visit_member, 0) -- T:245 C:183
	local visit<const>: *gc_visit_list = ram_base + control + list -- T:250,252,254 C:188,190,192
	if tail ~= 0 then -- T:246 C:184
		local last<const> = tail << gc_record_shift -- T:247 C:185
		local last_header<const>: *u8 = ram_base + last + gc_visit_header_byte -- T:248 C:186
		set_visit_link(last, *last_header, index) -- T:248 C:186
	else -- T:249 C:187
		visit.head = index -- T:250 C:188
	end
	visit.tail = index -- T:252 C:190
	local count<const> = index_word(control, list + offsetof(gc_visit_list.count)) -- T:253 C:191
	visit.count = (count + 1) & gc_gray_index_mask -- T:254 C:192
end

local publish_object<const> = function(control, address) -- T:119 C:235
	local state<const>: *gc_control = ram_base + control -- T:120,124 C:236,241
	local head<const> = control + offsetof(gc_control.object_head) -- T:120 C:236
	local link<const> = address - gc_object_link_before -- T:121 C:237
	local link_word<const>: *u32 = ram_base + (link & ram_word_mask) -- T:122 C:238
	*link_word = state.object_head -- T:122 C:238
	if state.sweep_link == head then state.sweep_link = link end -- T:124-125 C:241-242
	local count<const> = state.object_count + 1 -- T:126 C:243
	state.object_head = address -- T:126 C:243
	state.object_count = count -- T:126 C:243
end

local account_epoch_work<const> = function(control, work) -- T:801 C:865
	local state<const>: *gc_control = ram_base + control -- T:802 C:866
	local epoch_work<const> = state.epoch_work + work -- T:802 C:866
	if active(control) then -- T:803 C:867
		state.epoch_work = epoch_work -- T:804 C:868
	else -- T:805 C:869
		state.epoch_work = 0 -- T:806 C:870
		state.last_epoch_work = epoch_work -- T:806 C:870
		state.physical_assist = 0 -- T:807 C:871
	end
	return work -- T:809 C:873
end

return {
	internal = {
		white_offset = 0x01, -- T:86 H:91
		object_count_offset = 0x70, -- T:45 H:47
		sweep_link_offset = 0x74, -- T:46 H:48
		decode_gc_phase = decode_gc_phase,
		phase = phase,
		active = active,
		index_word = index_word,
		set_visit_link = set_visit_link,
	},
	append_visit = append_visit,
	publish_object = publish_object,
	account_epoch_work = account_epoch_work,
}
