module<const>

-- Source basis: 6a580740492a6ebdaca200fc90e243ebbcdcd230.
-- T/C/H GcHeap; U/P CPU; B native and A TS SETT/key ownership;
-- S/Y fault selectors; O/R object layout; I/J Thread kind; M RAM.
local queues<const> = require('kernel/gc_control') -- T:183,248-253,273-274,288 C:171-176,198-199,216 H:160
local mark<const> = require('kernel/gc_mark') -- T:184-190,301-302 C:95-101,231-232
local strings<const> = require('kernel/gc_strings') -- T:178 U:5049-5055,5057 P:3121-3125,3127
local allocator<const> = require('kernel/dlmalloc') -- T:148-151 C:253-256
local ram_base<const> = 0x08000000 -- T:277 C:202 M:6
local trace_head<const> = 4 -- T:25 H:23
local changed_head<const> = 8 -- T:26,302 H:24 C:232
local thread_visits<const> = 12 -- T:28 H:27
local weak_visits<const> = 28 -- T:29 H:28
local visit_count_offset<const> = 8 -- T:31 H:30
local remark_offset<const> = 0x44 -- T:38-39 H:37-38
local remark_state_offset<const> = remark_offset + 4 -- T:39 H:38
local root_cursor_offset<const> = 0x58 -- T:43 H:42
local record_shift<const> = 3 -- T:277 C:202 O:5 R:8
local object_prefix<const> = 8 -- T:151 C:256 O:6,9 R:9,13
local record_link<const> = 4 -- T:286 C:214 O:8 R:15
local record_color<const> = 1 -- T:172 H:145 O:3 R:6
local color_mask<const> = 3 -- T:172 H:145 O:4 R:7
local black<const> = 3 -- T:302 C:232
local visit_header<const> = 3 -- T:64,278 C:203 H:62
local visit_member<const> = 0x40 -- T:65,280,288 C:205,216 H:63
local gray_index_bits<const> = 19 -- T:286 C:214 O:12 R:17
local visit_link_low_bits<const> = 32 - gray_index_bits -- T:66,287 C:168,215
local visit_link_high_mask<const> = ((1 << gray_index_bits) - 1) >> visit_link_low_bits -- T:67,287 C:169,215
local threads_stage<const> = 1 -- T:62,620 H:144 C:652
local weak_stage<const> = 2 -- T:62,272,623 H:144 C:197,655
local roots_stage<const> = 3 -- T:62,633 H:144 C:665
local thread_kind<const> = 4 -- T:167,621 C:210,653 I:33 J:18
local table_kind<const> = 6 -- T:154,628 C:68,207,660
local system_constants_start<const> = 3 << (gray_index_bits + 1) -- T:58,69,636 C:71,668 H:20
local fault_count<const> = 13 -- U:450,5054 P:111,3125 S:46 Y:51; highest reason plus one
local explicit_fault<const> = 8 -- U:5055 P:99,3125 S:42 Y:47

struct visit_list -- T:28-31,292-295 H:27-30 C:220-223
	head: u32 -- T:293-294 C:221-222
	tail: u32 -- T:293 C:221
	count: u32 -- T:295 C:223
end

struct visit_frontier -- T:38-39,296-297 H:37-38 C:224-226
	index: u32 -- T:273,297,624 C:198,225,656
	state: u32 -- T:274,297,612,615,624-625 C:199,225-226,656-657 H:186-190
end

struct remark_gray_heads -- T:25-26,632 H:23-24 C:664
	trace: u32 -- T:632 C:664
	changed: u32 -- T:632 C:664
end

-- Field snapshot of stationary CPU inputs, not a packed staging loop over
-- arbitrary host roots. The fault-id plane is written once by its producer:
-- static errors are Strings, and the explicit-exception slot is zero.
-- C++ does not mark Mode from remark; its fresh epoch passes mark_mode=1.
-- pending_string_work replaces the native String mark latch; it is handed
-- back separately (the original visit work is only the number of records).
struct root_head_input
	pending_string_work: u32 -- T:634,643 C:666,678
	mode: addr -- U:433,5049 C:1050
	index: addr -- U:430,5050 P:3121
	new_index: addr -- U:431,5051 A:54-56 P:3122
	length: addr -- U:432,5052 P:3123
	error: addr -- U:438,5053 P:95,3124
	fault_ids: addr -- U:439-450,5054-5055 P:99-111,3125
	string_index_tag: u32 -- U:5056 P:3126
	string_index_word: u32 -- U:5056 P:3126
	comparison_remaining: u32 -- U:5057 P:3127
	comparison_left: addr -- U:5057 P:3127
	comparison_right: addr -- U:5057 P:3127
	has_pending_assignment: u32 -- U:5058,758-759 P:3128 B:201-203
	receiver: addr -- U:760 B:204
	key_tag: u32 -- U:761 B:205
	key_word: u32 -- U:761 B:205
	value_tag: u32 -- U:762 B:206
	value_word: u32 -- U:762 B:206
end

local mark_root_head<const> = function(control, arena, metadata, input, mark_mode, replace_color_byte) -- U:5048 P:3119; mark_mode selects the calling path
	local head<const>: *root_head_input = ram_base + input -- T:634 C:666; explicit producer publication
	local work = head.pending_string_work -- T:634,643 C:666,678; preserve existing earned String work
	if mark_mode ~= 0 then work = work + strings.mark(metadata, head.mode) end -- U:5049 C:1050; C++ fresh epoch, not remark
	work = work + strings.mark(metadata, head.index) -- U:5050 P:3121
	work = work + strings.mark(metadata, head.new_index) -- U:5051 A:54-56 P:3122; TS' immutable key is already String
	work = work + strings.mark(metadata, head.length) -- U:5052 P:3123
	work = work + strings.mark(metadata, head.error) -- U:5053 P:95,3124; C++'s immutable error is already String
	local faults<const>: *u32 = head.fault_ids -- U:5054 P:3125
	for index = 0, fault_count - 1 do -- U:5054 P:3125
		if replace_color_byte ~= 0 or index ~= explicit_fault then -- U:5055 P:99,3125; C++ nil maps to zero String id with no edge
			work = work + strings.mark(metadata, faults[index]) -- U:5055 P:3125
		end
	end
	local _<const>, string_work<const> = mark.mark_value(control, arena, metadata, head.string_index_tag, head.string_index_word, trace_head, replace_color_byte) -- U:5056 P:3126
	work = work + string_work -- T:643 C:678
	if head.comparison_remaining ~= 0 then -- U:5057 P:3127
		work = work + strings.mark(metadata, head.comparison_left) -- U:5057 P:3127
		work = work + strings.mark(metadata, head.comparison_right) -- U:5057 P:3127
	end
	if head.has_pending_assignment ~= 0 then -- U:5058,758-759 P:3128 B:201-203
		mark.mark_record(control, arena, head.receiver, table_kind, trace_head, replace_color_byte) -- U:760 B:204
		local _<const>, key_work<const> = mark.mark_value(control, arena, metadata, head.key_tag, head.key_word, trace_head, replace_color_byte) -- U:761 B:205
		work = work + key_work -- T:643 C:678
		local _<const>, value_work<const> = mark.mark_value(control, arena, metadata, head.value_tag, head.value_word, trace_head, replace_color_byte) -- U:762 B:206
		work = work + value_work -- T:643 C:678
	end
	head.pending_string_work = work -- T:634,643 C:666,678; carry to the original later drain
end

-- visitList's two requeue specializations. The stopped weak-clear visitor
-- is intentionally distinct: it drains a Table and publishes a trace pair.
local visit_list_for_remark<const> = function(control, arena, list_offset, kind, drain, allowance, stage, replace_color_byte) -- T:270-271 C:195-196
	local resume_weak<const> = stage == weak_stage -- T:272 C:197
	local index = queues.internal.index_word(control, resume_weak and remark_offset or list_offset) -- T:273 C:198
	local remaining = queues.internal.index_word(control, resume_weak and remark_state_offset or list_offset + visit_count_offset) -- T:274 C:199
	local visits = 0 -- T:275 C:200
	while index ~= 0 and remaining ~= 0 and visits < allowance do -- T:276 C:201
		local offset<const> = index << record_shift -- T:149,277 C:202,254
		local address<const> = ram_base + offset -- T:277 C:202
		local meta_byte<const>: *u8 = address + visit_header -- T:278 C:203
		local meta<const> = *meta_byte -- T:278 C:203
		local header<const>: *u8 = address -- T:150,280-281 C:207,210,255; address is canonical from the masked queue index
		if (meta & visit_member) == 0 or *header ~= kind or allocator.bmsx_dlmalloc_is_object(arena, offset - object_prefix) == 0 then -- T:148-151,154,166-167,280-281 C:205-210,253-256,268-269,284-285
			index = 0 -- T:282 C:205,207,210
			break -- T:282 C:205,207,210
		end
		remaining = remaining - 1 -- T:284 C:212
		visits = visits + 1 -- T:285 C:213
		local link<const>: *u32 = address + record_link -- T:286 C:214
		local low<const> = *link >> gray_index_bits -- T:286 C:214
		index = low | ((meta & visit_link_high_mask) << visit_link_low_bits) -- T:287 C:215
		if drain ~= 0 then queues.internal.set_visit_link(address, meta & ~visit_member, 0) end -- T:248-253,288 C:171-176,216
		local color<const>: *u8 = address + record_color -- T:172,289,301-302 C:217,231-232 H:145
		if (*color & color_mask) == black then -- T:289,301-302 C:217,231-232
			mark.enqueue(control, address, record_link, changed_head, replace_color_byte) -- T:289,302 C:217,232
		end
	end
	if index == 0 or remaining == 0 then index, remaining = 0, 0 end -- T:291 C:219
	if drain ~= 0 then -- T:292 C:220
		local list<const>: *visit_list = ram_base + control + list_offset -- T:293-295 C:221-223
		if index == 0 then -- T:293 C:221
			list.head = 0 -- T:293 C:221
			list.tail = 0 -- T:293 C:221
		else -- T:294 C:222
			list.head = index -- T:294 C:222
		end
		list.count = remaining -- T:295 C:223
	elseif resume_weak then -- T:296 C:224
		local frontier<const>: *visit_frontier = ram_base + control + remark_offset -- T:297 C:225-226
		frontier.index = index -- T:297 C:225-226
		frontier.state = (stage << gray_index_bits) | remaining -- T:297 C:226
	end
	return visits -- T:299 C:228
end

local remark_visits<const> = function(control, arena, metadata, head_input, allowance, replace_color_byte) -- T:617-618 C:645-649; diagnostics remain with its caller
	local frontier<const>: *visit_frontier = ram_base + control + remark_offset -- T:612,615,624 C:656 H:186-190
	local stage, visits = frontier.state >> gray_index_bits, 0 -- T:611-612,619 C:650-651 H:186-187
	if stage == threads_stage then -- T:620 C:652
		visits = visit_list_for_remark(control, arena, thread_visits, thread_kind, 1, allowance, stage, replace_color_byte) -- T:621 C:653
		if queues.internal.index_word(control, thread_visits) ~= 0 then return visits end -- T:622 C:654
		stage = weak_stage -- T:623 C:655
		frontier.index = queues.internal.index_word(control, weak_visits) -- T:624 C:656
		frontier.state = (stage << gray_index_bits) | queues.internal.index_word(control, weak_visits + visit_count_offset) -- T:624-625 C:656-657
	end
	if stage == weak_stage then -- T:627 C:659
		visits = visits + visit_list_for_remark(control, arena, weak_visits, table_kind, 0, allowance - visits, stage, replace_color_byte) -- T:628 C:660
		if queues.internal.index_word(control, remark_offset) ~= 0 or visits == allowance then return visits end -- T:629 C:661
		local heads<const>: *remark_gray_heads = ram_base + control + trace_head -- T:632 C:664
		heads.trace = queues.internal.index_word(control, changed_head) -- T:632 C:664
		heads.changed = 0 -- T:632 C:664
		frontier.state = roots_stage << gray_index_bits -- T:614-615,633 C:665 H:189-190
		mark_root_head(control, arena, metadata, head_input, replace_color_byte == 0 and 1 or 0, replace_color_byte) -- T:634 U:5049 C:666 P:3119-3128
		local root_cursor<const>: *u32 = ram_base + control + root_cursor_offset -- T:636 C:668
		*root_cursor = system_constants_start -- T:636 C:668
	end
	return visits -- T:638 C:670
end

return {
	internal = { visit_list_for_remark = visit_list_for_remark },
	mark_root_head = mark_root_head,
	remark_visits = remark_visits,
}
