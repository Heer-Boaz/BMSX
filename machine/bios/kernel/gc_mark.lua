module<const>

-- Source basis: 1a77f86de7ee9943612a729dc32f2534fda7b6a3.
-- T/C/H: GcHeap; O/P: object layout; V/W: Value; I/J: Thread;
-- S/R/Q: StringPool; A/B/D: allocator predicate; M: RAM map.
local control_layout<const> = require('kernel/gc_control') -- T:93,182 C:96 H:92,160
local allocator<const> = require('kernel/dlmalloc') -- T:316 C:263 A:54 B:52 D:679-683
local strings<const> = require('kernel/gc_strings') -- T:177,335 C:88 H:120 S:34,430-435,446 R:419-425,439 Q:17

local ram_base<const> = 0x08000000 -- M:6
local ram_word_mask<const> = 0x003ffffc -- M:7-9
local ram_byte_mask<const> = 0x003fffff -- M:7
local color_offset<const> = 1 -- O:3 P:6
local color_mask<const> = 3 -- O:4 P:7
local record_shift<const> = 3 -- O:5 P:8
local object_prefix<const> = 1 << record_shift -- O:6,9 P:9,13
local record_mask<const> = (ram_byte_mask + 1) - object_prefix -- O:7 P:10 M:7
local record_link<const> = 4 -- O:8 P:15
local gray_index_mask<const> = (1 << 19) - 1 -- O:12-13 P:17-18
local gray<const> = 2 -- T:187 C:100
local string_tag<const> = 5 -- V:9-11 W:21-22
local table_tag<const> = 6 -- V:9-11 W:21-22
local closure_tag<const> = 7 -- V:9-11 W:21-22
local thread_tag<const> = 9 -- V:9-11 W:21-22
local thread_kind<const> = 4 -- I:33 J:18 T:307 C:273

local unmarked<const> = function(control, flags) -- T:172 H:146
	local white<const>: *u8 = ram_base + control + control_layout.internal.white_offset -- T:93 H:92
	return (flags & color_mask) == (*white & 1) -- T:93,172 H:92,146
end

local set_color<const> = function(address, color, replace_color_byte) -- T:173 H:147
	local lane<const>: *u8 = ram_base + ((address + color_offset) & ram_byte_mask) -- T:174 H:148
	-- TS writes just the low two bits; C++ overwrites the byte. The
	-- caller selects its originating mirror's store for this operation.
	if replace_color_byte ~= 0 then -- T:175 H:149; explicit mirror choice
		*lane = color -- H:149
	else -- T:175 H:149; TS color lane
		*lane = (*lane & ~color_mask) | color -- T:175
	end
end

local enqueue<const> = function(control, address, link, queue, replace_color_byte) -- T:183 C:95
	local previous<const> = control_layout.internal.index_word(control, queue) -- T:182,184 C:96 H:160
	local link_word<const>: *u32 = ram_base + ((address + link) & ram_word_mask) -- T:185-186 C:97,99
	local other_bits<const> = link == record_link and (*link_word & ~gray_index_mask) or 0 -- T:185 C:97
	local head<const> = (address & record_mask) >> record_shift -- T:188 C:98
	*link_word = other_bits | previous -- T:186 C:99
	set_color(address, gray, replace_color_byte) -- T:187 C:100
	local queue_word<const>: *u32 = ram_base + control + queue -- T:188 C:101
	*queue_word = head -- T:188 C:101
end

local mark_record<const> = function(control, arena, address, kind, queue, replace_color_byte) -- T:312 C:259
	local offset<const> = address & record_mask -- T:313 C:260
	local record<const>: *u32 = ram_base + offset -- T:314 C:261
	local header<const> = *record -- T:314 C:261
	if (header & 0xff) ~= kind or not unmarked(control, header >> 8) then return 0 end -- T:315 C:262
	if allocator.bmsx_dlmalloc_is_object(arena, offset - object_prefix) == 0 then return 0 end -- T:316 C:263 A:54 B:52 D:679-683
	enqueue(control, ram_base + offset, record_link, queue, replace_color_byte) -- T:317 C:264
	return 1 -- T:318 C:265; return the object-mark boolean as a work word
end

-- Value tags and payloads arrive in separate lanes. A String's mark work
-- returns alongside the object-mark boolean instead of a host accumulator.
-- The tag cases are disjoint; the dispatch follows the TS case order.
local mark_value<const> = function(control, arena, metadata, tag, payload, queue, replace_color_byte) -- T:330 C:77 V:18-19 W:29-30
	if tag == table_tag then -- T:331-332 C:78,81
		return mark_record(control, arena, payload, table_tag, queue, replace_color_byte), 0 -- T:309-310,332 C:82,297-298
	elseif tag == closure_tag then -- T:333 C:83
		return mark_record(control, arena, payload, closure_tag, queue, replace_color_byte), 0 -- T:327-328,333 C:84,280-281
	elseif tag == thread_tag then -- T:334 C:79
		return mark_record(control, arena, payload, thread_kind, queue, replace_color_byte), 0 -- T:306-307,334 C:80,272-273
	elseif tag == string_tag then -- T:335 C:87
		local work<const> = strings.mark(metadata, payload) -- T:177,335 C:88 H:120 S:430-435,446 R:419-425,439 W:68
		return 0, work -- T:335,337 C:89 S:448-451 R:441; explicit work instead of a host latch
	end
	return 0, 0 -- T:337 C:85-86,90-91; BuiltinFunction and all non-edge tags
end

return {
	internal = { unmarked = unmarked, set_color = set_color },
	enqueue = enqueue,
	mark_record = mark_record,
	mark_value = mark_value,
}
