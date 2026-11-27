module<const>

-- Source basis: 70791ac4b03d36b191348c5810ca2cf3af2dc6c2.
-- T/C/H refer to the two GcHeap owners and the C++ header. A/B/D are
-- the Table record owners, O/P are GC object constants, V/W are Value tags,
-- I/J are Thread record kinds, U/Z are Upvalue records, and M is RAM decode.
-- L/K/E are the Closure owners, F/G frame and protected-call sizes,
-- and Q/R define stack compaction's retained-word charge.
local control_layout<const> = require('kernel/gc_control') -- T:740,744,762 C:802,806,824
local allocator<const> = require('kernel/dlmalloc_record') -- T:789,792,799-802 C:849,852,859-862 A:167-168,172 B:510-511,516
local thread_compact<const> = require('kernel/gc_thread_compact') -- T:774-776 C:836-837
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
local closure_latched<const> = 8 << 16 -- L:33,36 K:52,55 T:791 C:851
local capture_high_byte<const> = 3 -- L:37 K:56
local capture_gray_word<const> = 4 -- O:8 P:15
local gray_index_bits<const> = 19 -- O:12 P:17
local capture_low_bits<const> = 32 - gray_index_bits -- L:38 K:57
local closure_prefix_bytes<const> = 12 -- L:40 K:59
local closure_latched_bytes<const> = 24 -- L:41 K:60
local thread_bytes<const> = 80 -- I:28 J:13
local value_slot_bytes<const> = 5 -- I:29 J:14
local frame_bytes<const> = 56 -- F:21 G:34
local protected_bytes<const> = 20 -- F:152 G:28
local thread_control_count_mask<const> = (1 << 18) - 1 -- I:34 J:27
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

struct thread_record
	before_stack: u32[6] -- I:21-22 J:20-21
	value_block: addr -- I:22,120 J:21,59
	value_capacity: u32 -- I:22,122 J:21,60
	frame_capacity: u32 -- I:23,123 J:22,61
	protected_capacity: u32 -- I:23,124 J:22,62
	before_control_blocks: u32[6] -- I:23-24 J:22-23
	frame_block: addr -- I:24,128 J:23,63
	protected_block: addr -- I:24,130 J:23,64
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

local free_closure<const> = function(arena, occupied, address, header) -- T:789-792 C:849-852
	local low_word<const>: *u32 = ram_base + ((address + capture_gray_word) & ram_word_mask) -- L:50-51 E:68-69
	local low<const> = *low_word >> gray_index_bits -- L:51 E:69
	local high_byte<const>: *u8 = ram_base + ((address + capture_high_byte) & ram_byte_mask) -- L:52 E:70
	local high<const> = *high_byte & 0x7f -- L:52 E:70
	local captures<const> = low | (high << capture_low_bits) -- L:53 E:71
	local tail<const> = (header & closure_latched) ~= 0 and closure_latched_bytes or 0 -- T:791 C:851 L:42-43 K:64-65
	local bytes<const> = closure_prefix_bytes + 4 * captures + tail -- L:42-43 K:64-65
	allocator.bmsx_dlmalloc_release_object(arena, address - ram_base, bytes, occupied) -- T:792 C:852
end

local free_thread<const> = function(arena, occupied, address) -- T:796-797,799-802 C:857,859-862
	-- Capture the original descriptors before releasing any backing. No
	-- cache or view is part of the firmware-owned record lifetime.
	local thread<const>: *thread_record = ram_base + (address & ram_word_mask) -- T:796-797 C:857 I:118-119 J:57
	local value_block<const> = thread.value_block -- I:120 J:59
	local value_capacity<const> = thread.value_capacity -- I:122 J:60
	local frame_capacity<const> = thread.frame_capacity -- I:123 J:61
	local protected_capacity<const> = thread.protected_capacity -- I:124 J:62
	local frame_block<const> = thread.frame_block -- I:128 J:63
	local protected<const> = thread.protected_block -- I:130 J:64
	allocator.bmsx_dlmalloc_release_record(arena, value_block - ram_base, value_capacity * value_slot_bytes, occupied) -- T:799 C:859 J:38
	allocator.bmsx_dlmalloc_release_record(arena, frame_block - ram_base, (frame_capacity & thread_control_count_mask) * frame_bytes, occupied) -- T:800 I:123 C:860 J:39,61
	if protected ~= 0 then -- T:801 C:861
		allocator.bmsx_dlmalloc_release_record(arena, protected - ram_base, (protected_capacity & thread_control_count_mask) * protected_bytes, occupied) -- T:801 I:124 C:861 J:40,62
	end
	allocator.bmsx_dlmalloc_release_object(arena, address - ram_base, thread_bytes, occupied) -- T:802 C:862
end

-- RAM instruction state carries the loop across yields. The kind-byte clear
-- in release_object invalidates host observations; no host action participates
-- in reclaiming a record or publishing the quantum's count and cursor.
local sweep_objects<const> = function(control, arena, occupied, growing_thread, compact_threads, hash_first, allowance) -- T:738 C:801
	local cursor<const>: *u32 = ram_base + control + control_layout.internal.sweep_link_offset -- T:739-740 C:802
	local link = *cursor -- T:741 C:803
	if link == 0 then return 0 end -- T:742 C:804
	local link_word: *u32 = ram_base + (link & ram_word_mask) -- T:743 C:805
	local address = *link_word -- T:743 C:805
	local white_byte<const>: *u8 = ram_base + control + control_layout.internal.white_offset -- T:89,744 C:806 H:92
	local white<const> = *white_byte & 1 -- T:89,744 C:806 H:92
	local work, removed = 0, 0 -- T:745-746 C:807-808
	while address ~= 0 and work < allowance do -- T:747 C:809
		local next_link<const> = address - object_link_before -- T:750 C:812
		local next_word<const>: *u32 = ram_base + (next_link & ram_word_mask) -- T:751 C:813
		local next_record<const> = *next_word -- T:751 C:813
		local header_word<const>: *u32 = ram_base + (address & ram_word_mask) -- T:752 C:814
		local header<const> = *header_word -- T:752 C:814
		local garbage<const> = ((header >> 8) & color_mask) == (white ~ 1) -- T:753 C:815
		local kind<const> = header & 0xff -- T:769-770 C:831-832
		if garbage then -- T:754,771 C:816,833
			*link_word = next_record -- T:755 C:817
			removed = removed + 1 -- T:756 C:818
			if kind == table_kind then -- T:781 C:841
				free_table(arena, occupied, address, hash_first) -- T:782 C:842
			elseif kind == thread_kind then -- T:786,796 C:845,857
				free_thread(arena, occupied, address) -- T:796-797,799-802 C:857,859-862
			elseif kind == upvalue_kind then -- T:789 C:849
				allocator.bmsx_dlmalloc_release_object(arena, address - ram_base, upvalue_bytes, occupied) -- T:789,792 C:849,852
			else -- T:786,789 C:845,849
				free_closure(arena, occupied, address, header) -- T:790-792 C:850-852
			end
		else -- T:757 C:819
			link = next_link -- T:757 C:819
			link_word = next_word -- T:755,757 C:817,819
			local color<const>: *u8 = ram_base + ((address + color_offset) & ram_byte_mask) -- T:772 C:834
			*color = white -- T:772 C:834
			if kind == thread_kind and compact_threads ~= 0 and address ~= growing_thread then -- T:773 C:835
				local retained<const> = thread_compact.shrink_stack(arena, occupied, address) -- T:774-776 C:836-837
				if retained ~= 0 then -- T:778 C:838; native view attachment is owned at CPU consumption
					work = work + 2 * ((retained + 3) >> 2) -- T:779 C:839 Q:66-68 R:69-71; policy work, not a second CPU charge
				end
			end
		end
		work = work + 1 -- T:758,773,779,784,794,804 C:820,835,839,843,853,863
		address = next_record -- T:759 C:821
	end
	if removed ~= 0 then -- T:761 C:823
		local count<const>: *u32 = ram_base + control + control_layout.internal.object_count_offset -- T:762 C:824
		*count = *count - removed -- T:763 C:825
	end
	if address ~= 0 then *cursor = link else *cursor = 0 end -- T:765 C:827
	return work -- T:766 C:828
end

return {
	internal = { free_table = free_table, free_closure = free_closure, free_thread = free_thread },
	sweep_objects = sweep_objects,
}
