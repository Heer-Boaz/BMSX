module<const>

-- Source basis: 70791ac4b03d36b191348c5810ca2cf3af2dc6c2.
-- T/C/H refer to the two GcHeap owners and the C++ header. A/B/D are
-- the Table record owners, O/P are GC object constants, V/W are Value tags,
-- I/J are Thread record kinds, U/Z are Upvalue records, and M is RAM decode.
local control_layout<const> = require('kernel/gc_control') -- T:740,744,762 C:802,806,824
local allocator<const> = require('kernel/dlmalloc_record') -- T:789,792 C:849,852 A:167-168,172 B:510-511,516
local ram_base<const> = 0x08000000 -- M:6
local ram_word_mask<const> = 0x003ffffc -- M:9
local ram_byte_mask<const> = 0x003fffff -- M:7
local color_offset<const> = 1 -- O:3 P:6
local color_mask<const> = 3 -- O:4 P:7
local object_link_before<const> = 4 -- O:10 P:14
local table_kind<const> = 6 -- V:9-11 W:21-23
local thread_kind<const> = 4 -- I:33 J:18
local upvalue_kind<const> = 11 -- U:11 Z:13
local upvalue_bytes<const> = 16 -- U:9 Z:11
local table_header_charge<const> = 32 -- A:53 D:43
local array_slot_charge<const> = 5 -- A:167 B:511
local hash_slot_charge<const> = 10 -- A:19,168 B:19,73-75,510

struct table_record
	kind_header: u32 -- A:33-35 D:26-28
	gray: u32 -- A:34 D:27
	metatable: addr -- A:34 D:27
	hash_storage: addr -- A:137,166 D:55
	array_capacity: u32 -- A:132,167 D:57
	hash_slots: u32 -- A:133,168 D:58
	length: u32 -- A:34 D:27
	free: i32 -- A:34 D:27
	array_storage: addr -- A:136,166 D:56
end

-- Saved loop locals across the private handoff to a native record owner.
struct object_sweep_context
	link: addr -- T:741,757 C:803,819
	work: u32 -- T:745,758 C:807,820
	removed: u32 -- T:746,756 C:808,818
	deferred: addr -- T:773-779,783,787-803 C:835-839,846-852,857-862; private continuation reason
	allowance: u32 -- T:738,747 C:801,809
end

local free_table<const> = function(arena, occupied, address, hash_first) -- T:782 C:842 A:165,170 B:508,514
	local table<const>: *table_record = ram_base + (address & ram_word_mask) -- A:120 B:508 D:55-58
	if hash_first ~= 0 then -- A:166-168 B:509-511; preserve the C++ release order
		local hash<const> = table.hash_storage -- B:509 D:55
		if hash ~= 0 then allocator.bmsx_dlmalloc_release_record(arena, hash - ram_base, hash_slot_charge * table.hash_slots, occupied) end -- B:510,73-75 D:58
		local array<const> = table.array_storage -- B:511 D:56
		if array ~= 0 then allocator.bmsx_dlmalloc_release_record(arena, array - ram_base, array_slot_charge * table.array_capacity, occupied) end -- B:511 D:57
	else -- A:166-168 B:509-511; preserve the TS release order
		local array<const>, hash<const> = table.array_storage, table.hash_storage -- A:136-137,166
		if array ~= 0 then allocator.bmsx_dlmalloc_release_record(arena, array - ram_base, array_slot_charge * table.array_capacity, occupied) end -- A:132,167
		if hash ~= 0 then allocator.bmsx_dlmalloc_release_record(arena, hash - ram_base, hash_slot_charge * table.hash_slots, occupied) end -- A:133,168
	end
	allocator.bmsx_dlmalloc_release_object(arena, address - ram_base, table_header_charge, occupied) -- A:171-172 B:515-516
end

-- Decode callback/compaction eligibility before unlinking or recoloring.
-- A native record owner acts at the saved link within this quantum;
-- the collector's count and cursor remain unpublished until it finishes.
local sweep_objects<const> = function(control, arena, occupied, object_context, growing_thread, compact_threads, hash_first, observe_retirement) -- T:738 C:801
	local context<const>: *object_sweep_context = ram_base + object_context -- T:741,745-747 C:803,807-809; private handoff of loop locals
	local link = context.link -- T:741 C:803
	if link == 0 then -- T:742 C:804
		context.deferred = 0 -- T:742 C:804; no pending record owner
		return 0 -- T:742 C:804
	end
	local link_word: *u32 = ram_base + (link & ram_word_mask) -- T:743 C:805
	local address = *link_word -- T:743 C:805
	local white_byte<const>: *u8 = ram_base + control + control_layout.internal.white_offset -- T:89,744 C:806 H:92
	local white<const> = *white_byte & 1 -- T:89,744 C:806 H:92
	local work, removed = context.work, context.removed -- T:745-746 C:807-808
	local allowance<const> = context.allowance -- T:738,747 C:801,809
	local deferred = 0 -- T:773-779,783,787-793,796-803 C:835-839,846-852,857-862; continuation result
	while address ~= 0 and work < allowance do -- T:747 C:809
		local next_link<const> = address - object_link_before -- T:750 C:812
		local next_word<const>: *u32 = ram_base + (next_link & ram_word_mask) -- T:751 C:813
		local next_record<const> = *next_word -- T:751 C:813
		local header_word<const>: *u32 = ram_base + (address & ram_word_mask) -- T:752 C:814
		local header<const> = *header_word -- T:752 C:814
		local garbage<const> = ((header >> 8) & color_mask) == (white ~ 1) -- T:753 C:815
		local kind<const> = header & 0xff -- T:769-770 C:831-832
		if garbage then -- T:754,771 C:816,833
			if kind == table_kind then -- T:781 C:841
				if observe_retirement ~= 0 then deferred = address; break end -- T:783; inspector owns retirement after release
			elseif kind ~= upvalue_kind then -- T:786-804 C:845-863; closures and Threads remain with their existing owners
				deferred = address -- T:787-804 C:846-863
				break -- T:787-804 C:846-863
			end
			*link_word = next_record -- T:755 C:817
			removed = removed + 1 -- T:756 C:818
			if kind == table_kind then -- T:781 C:841
				free_table(arena, occupied, address, hash_first) -- T:782 C:842
			else -- T:786,789 C:845,849
				allocator.bmsx_dlmalloc_release_object(arena, address - ram_base, upvalue_bytes, occupied) -- T:789,792 C:849,852
			end
		else -- T:757 C:819
			if kind == thread_kind and compact_threads ~= 0 and address ~= growing_thread then -- T:773 C:835
				deferred = address -- T:774-779 C:836-839
				break -- T:774-779 C:836-839
			end
			link = next_link -- T:757 C:819
			link_word = next_word -- T:755,757 C:817,819
			local color<const>: *u8 = ram_base + ((address + color_offset) & ram_byte_mask) -- T:772 C:834
			*color = white -- T:772 C:834
		end
		work = work + 1 -- T:758,773,784,794 C:820,835,843,853
		address = next_record -- T:759 C:821
	end
	if deferred ~= 0 then -- T:758-761 C:820-823; retain the active quantum for the deferred owner
		context.link = link -- T:741,757 C:803,819
		context.work = work -- T:745,758 C:807,820
		context.removed = removed -- T:746,756 C:808,818
		context.deferred = deferred -- T:773-779,783,787-803 C:835-839,846-852,857-862
		return work -- T:758,766 C:820,828; cumulative, not an independently committed quantum
	end
	if removed ~= 0 then -- T:761 C:823
		local count<const>: *u32 = ram_base + control + control_layout.internal.object_count_offset -- T:762 C:824
		*count = *count - removed -- T:763 C:825
	end
	local cursor<const>: *u32 = ram_base + control + control_layout.internal.sweep_link_offset -- T:739-740,765 C:802,827
	if address ~= 0 then *cursor = link else *cursor = 0 end -- T:765 C:827
	context.deferred = 0 -- T:765-766 C:827-828; retire the private continuation
	return work -- T:766 C:828
end

return {
	internal = { free_table = free_table },
	sweep_objects = sweep_objects,
}
