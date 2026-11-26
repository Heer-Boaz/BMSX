module<const>

-- Source basis: 1a77f86de7ee9943612a729dc32f2534fda7b6a3.
-- T/C are the ThreadRecord implementations, H is its C++ layout. F/G
-- own frame layouts, L/N logical accounting, A/B the arena adapter,
-- and M the memory decode. This is only the shrink path; the live views
-- are rebound by the caller after the physical work retires.
local allocator<const> = require('kernel/dlmalloc') -- T:171,206 C:112,152 A:70-72 B:68-70
local ram_base<const> = 0x08000000 -- A:71 B:69 M:6
local ram_word_mask<const> = 0x003ffffc -- T:121,129,163,203 H:37,41 C:101,149 M:9
local value_slot_bytes<const> = 5 -- T:29,160,173,221 H:14,38 C:95,114,171
local frame_bytes<const> = 56 -- F:21 G:34 T:134,226 C:176 H:41
local protected_bytes<const> = 20 -- F:152 G:28 T:228 C:178 H:40
local control_count_mask<const> = (1 << 18) - 1 -- T:34,123-126 H:27,54-64 C:160,178
local frame_window_mask<const> = 0x000fffff -- F:22 G:36 T:127,217-218 C:161,166-167
local sign_bit<const> = 0x80000000 -- T:213,215,220 C:163-164,170; unsigned capacity comparisons

struct thread_compact_record
	before_stack: u32[5] -- T:22 H:21
	stack_top: u32 -- T:22,127 H:21 C:161
	stack_block: addr -- T:22,120,158 H:21,59 C:93
	stack_capacity: u32 -- T:22,122,159 H:21,60 C:94
	frame_capacity: u32 -- T:23,123 H:22,61 C:176
	protected_capacity: u32 -- T:23,124 H:22,62 C:177
	before_depth: u32[4] -- T:23 H:22
	frame_depth: u32 -- T:24,125 H:23 C:160
	protected_depth: u32 -- T:24,126 H:23 C:178
	frame_block: addr -- T:24,128 H:23,63 C:176
	protected_block: addr -- T:24,130 H:23,64 C:177
end

struct thread_compact_frame
	before_window: u32[12] -- F:19 G:33
	stack_base: u32 -- F:19 G:33 T:217 C:166
	stack_capacity: u32 -- F:19 G:33 T:218 C:167
end

local resize_record_charge<const> = function(occupied, old_bytes, new_bytes) -- L:293-294 N:304-308
	local charged<const>: *u32 = ram_base + occupied -- L:272-274 N:306
	*charged = *charged - old_bytes + new_bytes -- L:272-274,294 N:305-308; only strictly shrinking extents reach this path
end

local shrink_stack_backing<const> = function(state, occupied, address, capacity) -- T:156,222 C:91,172; shrink-only branch
	local thread<const>: *thread_compact_record = ram_base + (address & ram_word_mask) -- T:157-159 C:92-94
	-- Only the shrink outcome reaches this path (T:161-162,166-169 C:97-100,107-110).
	-- The live Thread already owns its backing.
	local block<const>, previous<const> = thread.stack_block, thread.stack_capacity -- T:158-161 C:93-96
	local bytes<const> = capacity * value_slot_bytes -- T:160 C:95
	local offset<const> = block & ram_word_mask -- T:163 C:101-102
	local tags<const>, old_tags<const> = offset + capacity * 4, offset + previous * 4 -- T:164 C:103,106; kept=min(previous,capacity)=capacity
	-- Halving makes the retained source and destination disjoint and
	-- word-aligned. The ordered stores are the private RAM write frontier.
	local aligned<const> = capacity & ~3 -- T:165,170 C:106,111
	for index = 0, aligned - 4, 4 do -- T:165,170 C:106,111
		local source<const>: *u32 = ram_base + old_tags + index -- T:165 C:106
		local destination<const>: *u32 = ram_base + tags + index -- T:165,170 C:106,111
		*destination = *source -- T:165,170 C:106,111; ordinary firmware store tracks the changed word
	end
	for index = aligned, capacity - 1 do -- T:165,170 C:106,111
		local source<const>: *u8 = ram_base + old_tags + index -- T:165 C:106
		local destination<const>: *u8 = ram_base + tags + index -- T:165,170 C:106,111
		*destination = *source -- T:165,170 C:106,111; preserve the final partial word
	end
	allocator.bmsx_dlmalloc_shrink(state, block - ram_base, bytes) -- T:171 C:112 A:70-72 B:68-70
	thread.stack_block = block -- T:172 C:113
	thread.stack_capacity = capacity -- T:172 C:113
	resize_record_charge(occupied, previous * value_slot_bytes, bytes) -- T:173-174 C:114-115 L:293-294 N:304-308; the caller ignores the always-successful resize result
end

local shrink_controls<const> = function(state, occupied, address, field, block, capacity, depth, stride) -- T:199-200 C:145-146
	if capacity <= 4 or depth * 3 >= capacity then return 0 end -- T:201 C:147
	local next_capacity<const> = capacity >> 1 -- T:202 C:148
	local bytes<const> = next_capacity * stride -- T:202 C:148
	local start<const> = block & ram_word_mask -- T:203 C:149
	local spare<const> = start + depth * stride -- T:203 C:149
	for word = spare, start + bytes - 4, 4 do -- T:204-205 C:150-151; control strides are word multiples
		local slot<const>: *u32 = ram_base + word -- T:204-205 C:150-151
		*slot = 0 -- T:204-205 C:150-151
	end
	allocator.bmsx_dlmalloc_shrink(state, block - ram_base, bytes) -- T:206 C:152 A:70-72 B:68-70
	local capacity_word<const>: *u32 = ram_base + ((address + field) & ram_word_mask) -- T:207 C:153
	*capacity_word = next_capacity -- T:207 C:153
	resize_record_charge(occupied, capacity * stride, bytes) -- T:208 C:154 L:293-294 N:304-308
	return bytes -- T:209 C:155
end

local shrink_stack<const> = function(state, occupied, address) -- T:211 C:158
	local thread<const>: *thread_compact_record = ram_base + (address & ram_word_mask) -- T:118-119 C:159 H:54-67
	local capacity<const> = thread.stack_capacity -- T:122 C:163 H:60
	local frame_capacity<const> = thread.frame_capacity & control_count_mask -- T:123 C:176 H:61
	local protected_capacity<const> = thread.protected_capacity & control_count_mask -- T:124 C:177 H:62
	local depth<const> = thread.frame_depth & control_count_mask -- T:125 C:160 H:56-58
	local protected_depth<const> = thread.protected_depth & control_count_mask -- T:126 C:178 H:56-58
	local frame_block<const>, protected_block<const> = thread.frame_block, thread.protected_block -- T:128-131 C:176-177 H:63-64
	local used = thread.stack_top & frame_window_mask -- T:127,214 C:161
	local retained = 0 -- T:212 C:162
	if (capacity ~ sign_bit) > (16 ~ sign_bit) then -- T:213 C:163
		local index = 0 -- T:215 C:164
		while index < depth and ((used * 3) ~ sign_bit) < (capacity ~ sign_bit) do -- T:215 C:164; masked frame windows bound used*3 to 23 bits
			local frame<const>: *thread_compact_frame = ram_base + (frame_block & ram_word_mask) + index * frame_bytes -- T:129,133-135,216 C:165 H:41
			local base<const> = frame.stack_base & frame_window_mask -- T:217 C:166
			local extent<const> = frame.stack_capacity & frame_window_mask -- T:218 C:167
			local finish<const> = base + extent -- T:217-218 C:168
			if used < finish then used = finish end -- T:217-218 C:168
			index = index + 1 -- T:215 C:164
		end
		if ((used * 3) ~ sign_bit) < (capacity ~ sign_bit) then -- T:220 C:170
			local next_capacity<const> = capacity >> 1 -- T:221 C:171
			local bytes<const> = next_capacity * value_slot_bytes -- T:221 C:171
			shrink_stack_backing(state, occupied, address, next_capacity) -- T:222 C:172
			retained = bytes -- T:223 C:173
		end
	end
	retained = retained + shrink_controls(state, occupied, address, offsetof(thread_compact_record.frame_capacity), frame_block, frame_capacity, depth, frame_bytes) -- T:226 C:176
	retained = retained + shrink_controls(state, occupied, address, offsetof(thread_compact_record.protected_capacity), protected_block, protected_capacity, protected_depth, protected_bytes) -- T:227-228 C:177-178
	return retained -- T:229 C:179
end

return {
	internal = { resize_record_charge = resize_record_charge, shrink_stack_backing = shrink_stack_backing, shrink_controls = shrink_controls },
	shrink_stack = shrink_stack,
}
