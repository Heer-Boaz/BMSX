module<const>

-- Source basis: 1599e7a80b6c742d35333aff4c3b7bbde2671c64.
-- T/C: LuaHeap; I/J/H: ThreadRecord; L/N: collector; A/B: allocator
-- bindings; F/G: frame extent; M: RAM; X/Y: CPU; P/S: existing projection;
-- E: faults; V/W: native derived Thread views.
-- This operation owns reservation through publication, not CPU call entry.
-- The current Thread and the explicit source Closure remain roots; no code
-- runs from those frames until the posting operation retires.
local layout<const> = require('kernel/gc_runtime_layout') -- T:24,27-30 C:23-25 X:3983-4016
local root_inputs<const> = require('kernel/gc_root_inputs') -- X:3997-4016 S:168-188 P:119-122
local allocator<const> = require('kernel/dlmalloc') -- T:227-229,236 C:234-238,244 A:57-69 B:54-67
local admission<const> = require('kernel/heap_admission') -- T:73-106,223-226 C:81-116,230-233
local collector<const> = require('kernel/gc_step') -- L:1109-1124 N:1213-1229

local word_mask<const> = 0x003ffffc -- M:9 I:163,186 J:101,129,132
local control_count_mask<const> = (1 << 18) - 1 -- I:34 H:27 T:217 C:224
local value_bytes<const> = 5 -- I:29 H:14 T:212 C:220
local frame_bytes<const> = 56 -- F:21 G:34 T:213 C:221
local current_or_fresh<const> = 0 -- T:92,225 C:103,232
local out_of_memory<const> = 9 -- E:43 T:86 L:1111 C:98 N:1214

struct thread_storage_record
	before_top: u32[5] -- I:21-22 H:20-21
	stack_top: u32 -- I:22 H:21
	stack_block: addr -- I:22,158 H:21 J:93
	stack_capacity: u32 -- I:22,159 H:21 J:94
	frame_capacity: u32 -- I:23,187 H:22 J:122-124
	protected_capacity: u32 -- I:23 H:22
	error_word: u32 -- I:23 H:22
	error_tag: u32 -- I:23 H:22
	return_window: u32[2] -- I:23 H:22
	frame_depth: u32 -- I:24,188 H:23 J:123,131
	protected_depth: u32 -- I:24 H:23
	frame_block: addr -- I:24,182 H:23 J:125
end

-- Obtain the architectural Thread and caller while a resident CALL runs.
local active_call_frame<const> = function(management) -- X:3997-4007; select the resident caller's physical frame
	local state<const> = layout.ram_base + management -- X:4001-4004
	local project<const>: *word = state + layout.effect_offset -- X:3987-3991
	*project = layout.publish_roots -- X:3997-4000
	local roots<const>: *root_descriptors = state + layout.root_banks_offset -- X:4000,4004-4006
	local owner<const> = roots.active -- X:4004-4006
	local thread<const>: *thread_storage_record = owner -- I:20-24 H:20-24
	local depth<const> = thread.frame_depth & control_count_mask -- I:24,34 H:23,27
	return owner, layout.ram_base + ((thread.frame_block + (depth - 1) * frame_bytes) & word_mask) -- I:24 H:23 F:21 G:34
end

local value_planes<const> = function(address, first) -- I:156-165 J:91-106; borrow the slot planes without resizing them
	local thread<const>: *thread_storage_record = layout.ram_base + (address & word_mask) -- I:157-159 J:92-94
	local base<const> = layout.ram_base + (thread.stack_block & word_mask) -- I:163 J:101-102
	return base + 4 * first, base + 4 * thread.stack_capacity + first -- I:164-165 J:103-106
end

local update_charge<const> = function(occupied, previous, requested) -- T:304-306 C:307-310
	if previous ~= requested then -- T:305 C:308
		local charged<const>: *u32 = layout.ram_base + occupied -- T:284-285,305 C:309-310
		*charged = *charged - previous + requested -- T:285,305 C:310
	end
end

local resize_value_stack<const> = function(arena, occupied, address, capacity) -- I:156-174 J:91-115
	local thread<const>: *thread_storage_record = layout.ram_base + (address & word_mask) -- I:157-159 J:92-94
	local old<const>, previous<const> = thread.stack_block, thread.stack_capacity -- I:158-159 J:93-94
	local bytes<const> = capacity * value_bytes -- I:160 J:95
	local block = old -- I:161 J:96
	if capacity > previous then -- I:161 J:97
		local offset<const> = allocator.bmsx_dlmalloc_resize_backing(arena, old - layout.ram_base, bytes) -- I:161 A:67-69 J:98 B:64-66
		if offset == 0 then return false end -- I:162 J:99
		block = layout.ram_base + offset -- A:69 B:66
	end
	local base<const> = layout.ram_base + (block & word_mask) -- I:163 J:101-102
	local old_tags<const>, tags<const> = base + previous * 4, base + capacity * 4 -- I:164 J:103,106
	local kept<const> = capacity < previous and capacity or previous -- I:164 J:103
	local aligned<const> = kept & ~3 -- I:165 J:106; two aligned tag-plane bases
	if tags > old_tags and tags < old_tags + kept then -- I:165 J:106; copyWithin/memmove overlap direction
		local from<const>: *u8 = old_tags -- I:165 J:106
		local to<const>: *u8 = tags -- I:165 J:106
		for index = kept - 1, aligned, -1 do to[index] = from[index] end -- I:165,170 J:106,111
		local words<const>: *u32 = old_tags -- I:165 J:106
		local target<const>: *u32 = tags -- I:165 J:106
		for index = (aligned >> 2) - 1, 0, -1 do target[index] = words[index] end -- I:165,170 J:106,111
	else -- I:165 J:106; disjoint, same, or left-moving tag plane
		local words<const>: *u32 = old_tags -- I:165 J:106
		local target<const>: *u32 = tags -- I:165 J:106
		for index = 0, (aligned >> 2) - 1 do target[index] = words[index] end -- I:165,170 J:106,111
		local from<const>: *u8 = old_tags -- I:165 J:106
		local to<const>: *u8 = tags -- I:165 J:106
		for index = aligned, kept - 1 do to[index] = from[index] end -- I:165,170 J:106,111
	end
	if capacity > previous then -- I:166 J:107
		local start<const>: *u32 = old_tags -- I:167 J:108
		local added<const> = capacity - previous -- I:167-168 J:108-109
		for index = 0, added - 1 do start[index] = 0 end -- I:167,170 J:108,111
		local low<const>, high<const> = tags + previous, base + bytes -- I:168 J:109
		local middle<const> = (low + 3) & ~3 -- I:168 J:109; split the same byte extent at word boundaries
		local lane = low -- I:168 J:109
		while lane < middle and lane < high do -- I:168 J:109
			local tag<const>: *u8 = lane -- I:168 J:109
			*tag = 0 -- I:168,170 J:109,111
			lane = lane + 1 -- I:168 J:109
		end
		for position = lane, high - 4, 4 do -- I:168 J:109
			local tag_word<const>: *u32 = position -- I:168 J:109
			*tag_word = 0 -- I:168,170 J:109,111
			lane = position + 4 -- I:168 J:109
		end
		for position = lane, high - 1 do -- I:168 J:109
			local tag<const>: *u8 = position -- I:168 J:109
			*tag = 0 -- I:168,170 J:109,111
		end
	end
	if capacity < previous then allocator.bmsx_dlmalloc_shrink(arena, old - layout.ram_base, bytes) end -- I:171 J:112 A:71-72 B:68-70
	thread.stack_block = block -- I:172 J:113
	thread.stack_capacity = capacity -- I:172 J:113
	update_charge(occupied, previous * value_bytes, bytes) -- I:173 T:304-306 J:114 C:307-310
	return true -- I:174 J:115
end

local grow_frame_controls<const> = function(arena, occupied, address, capacity, staged) -- I:176-197 J:118-140; frames member of native growControls
	local thread<const>: *thread_storage_record = layout.ram_base + (address & word_mask) -- I:177,182 J:119,125
	-- C++ samples capacity before resize, TS after (I:187, J:124).
	-- The admitted owner record does not overlap its raw control backing.
	local previous<const> = thread.frame_capacity & control_count_mask -- I:187 J:124 H:27
	local old<const>, bytes<const> = thread.frame_block, capacity * frame_bytes -- I:182-183 J:125-126
	local offset = staged -- I:184 J:127
	if staged == 0 then -- I:184 J:127
		if old ~= 0 then -- I:184 J:127
			offset = allocator.bmsx_dlmalloc_resize_backing(arena, old - layout.ram_base, bytes) -- I:184 A:67-69 J:127 B:64-66
		else -- I:184 J:127
			offset = allocator.bmsx_dlmalloc_allocate(arena, bytes, 0) -- I:184 A:57-59 J:127 B:54-56
		end
		if offset == 0 then return false end -- I:185 J:128
	end
	local block<const> = layout.ram_base + offset -- I:186 A:59 J:129-130 B:56
	local words<const>: *u32 = block -- I:186,189-190 J:129-133
	local used<const> = (thread.frame_depth & control_count_mask) * frame_bytes -- I:188 J:131 H:27
	if staged ~= 0 then -- I:189 J:132
		local source<const>: *u32 = layout.ram_base + (old & word_mask) -- I:186,189 J:132
		for index = 0, (used >> 2) - 1 do words[index] = source[index] end -- I:189,191-192 J:132,134-135
	end
	for index = used >> 2, (bytes >> 2) - 1 do words[index] = 0 end -- I:190-192 J:133-135
	thread.frame_block = block -- I:193 J:136
	thread.frame_capacity = capacity -- I:194 J:137
	if staged ~= 0 then allocator.bmsx_dlmalloc_free(arena, old - layout.ram_base) end -- I:195 A:62 J:138 B:59
	update_charge(occupied, previous * frame_bytes, bytes) -- I:196 T:304-306 J:139 C:307-310
	return true -- I:197 J:140; original owner only checks nonzero
end

local reserve_frame_storage<const> = function(management, address, values, frames) -- T:200-238 C:209-246; one exact physical attempt
	local arena<const>, occupied<const> = management + layout.arena_offset, management + layout.occupied_offset -- T:227,285 A:25 C:234,288 B:20
	if values == 0 and frames ~= 0 then -- T:218-220 C:225-227; controls-only resize, not fresh staging
		local reserved<const> = grow_frame_controls(arena, occupied, address, frames, 0) -- T:205,219 C:214,226
		return reserved and 1 or 0 -- T:206-207 C:214-215; raw outcome for the owning retry
	end
	local staged = 0 -- T:229 C:238
	if frames ~= 0 then -- T:229-230 C:238-239
		staged = allocator.bmsx_dlmalloc_allocate(arena, frames * frame_bytes, 0) -- T:229 A:57-59 C:238 B:54-56
		if staged == 0 then return 0 end -- T:230,238 C:239,246; no Value work was started
	end
	if values == 0 or resize_value_stack(arena, occupied, address, values) then -- T:232 C:240
		if staged ~= 0 then grow_frame_controls(arena, occupied, address, frames, staged) end -- T:233 C:241; cannot fail once Values have been replaced
		return 1 -- T:234 C:242
	end
	if staged ~= 0 then allocator.bmsx_dlmalloc_free(arena, staged) end -- T:236 A:62 C:244 B:59; original rollback of just the staged Frames
	return 0 -- T:238 C:246
end

local publish_frame_roots<const> = function(management, interrupted) -- X:3997-4007 S:169-178; the source context determines publication
	if interrupted then root_inputs.publish_interrupt(management) -- X:3997-4007 S:169-178; fixed firmware reads the interrupted context directly
	else root_inputs.publish(management) end -- X:3997-4007 S:169-178
end

local grow_thread_frame_storage<const> = function(management, address, values, frames, root, source_cycles, interrupted) -- T:200-238 C:209-246
	local arena<const> = management + layout.arena_offset -- T:227 A:25 C:234 B:20
	local thread<const>: *thread_storage_record = layout.ram_base + (address & word_mask) -- T:215-217 C:223-224
	local previous_values<const> = values ~= 0 and thread.stack_capacity * value_bytes or 0 -- T:215 C:223
	local previous_frames<const> = frames ~= 0 and (thread.frame_capacity & control_count_mask) * frame_bytes or 0 -- T:216-217 C:224
	local requested<const>, previous<const> = values * value_bytes + frames * frame_bytes, previous_values + previous_frames -- T:212-213,222 C:220-221,229
	local charged<const> = requested - previous -- T:202,223-225 C:211,230-232
	local projected = false -- X:3997-4016 S:168-188; projection is lazy, never repeated on retry
	local recovery = current_or_fresh -- T:92,225 C:103,232
	if (values == 0 and frames ~= 0) or requested > previous then -- T:202,218-225 C:211,225-232
		local debt<const> = admission.allocation_debt(arena, charged) -- T:75 C:85
		if debt < 0 then -- T:76,93 C:86,104
			if charged > admission.heap_capacity(arena) then return out_of_memory + 1, 0, 0 end -- T:86 C:98 E:43; an impossible request does not collect
			repeat -- T:94-96 C:105-107
				recovery = admission.begin_allocation_recovery(arena, recovery) -- T:95 L:1110-1117 C:106 N:1213-1220
				if recovery < 0 then -- L:1111 N:1214
					root_inputs.release_string_work(management) -- X:4009-4013 S:180-184; only reachable after a projected epoch
					return out_of_memory + 1, 0, 0 -- L:1111 N:1214 E:43
				end
				if not projected then -- X:3997-4007 S:169-178
					publish_frame_roots(management, interrupted) -- T:95,202,224 C:106,211,231 X:3997-4007 S:169-178
					projected = true -- X:3997-4007 S:169-178
				end
				local work<const> = collector.finish_epoch(management, collector.step_words, address, 0, root) -- L:1123 N:1226; explicit Closure and growing Thread address
				source_cycles = admission.spend_assist_allowance(source_cycles, work) -- X:5197-5199 Y:2805-2807; shadow source allowance, not charged twice
			until admission.logical_fits(arena, charged) ~= 0 -- T:96 C:107
		elseif debt > 0 and source_cycles >= admission.internal.work_word_cycles then -- T:77-79 C:87-90 X:5201-5207 Y:2809-2815
			local pressure<const> = admission.logical_assist_pressure(arena, charged) -- T:78 C:88
			local words<const> = admission.limit_assist_allowance(admission.logical_assist_allowance(debt, pressure), source_cycles) -- T:79 C:89-90 X:5203-5206 Y:2811-2814
			publish_frame_roots(management, interrupted) -- X:3997-4007 S:169-178 T:79 C:90
			projected = true -- X:3997-4007 S:169-178
			local work<const> = collector.step(management, words, address, 0, root) -- T:79 C:90 X:5207 Y:2815
			source_cycles = admission.spend_assist_allowance(source_cycles, work) -- X:5208 Y:2816
			admission.credit_logical_assist(arena, charged, debt, pressure, work) -- T:80 C:91
		end
	end
	local words<const> = admission.reservation_assist_allowance(arena, requested, source_cycles) -- T:101-106,203,226 C:112-116,212,233 L:934-953 N:985-1003
	if words >= 0 then -- L:952-953 N:1001-1002; zero is a present source allowance
		if not projected then -- X:3997-4007 S:169-178
			publish_frame_roots(management, interrupted) -- X:3997-4007 S:169-178
			projected = true -- X:3997-4007 S:169-178
		end
		collector.step(management, words, address, 0, root) -- T:105,203,226 C:116,212,233 X:5207 Y:2815
	end
	while true do -- T:204,228 C:213,235
		if reserve_frame_storage(management, address, values, frames) ~= 0 then -- T:205-206,229-235 C:214,238-243
			if projected then root_inputs.release_string_work(management) end -- X:4009-4013 S:180-184
			return 0, 0, 0 -- T:206,234 C:214,242; original CALL owner receives no Lua Value from reservation
		end
		recovery = admission.begin_allocation_recovery(arena, recovery) -- T:207,238 C:215,246 L:1110-1117 N:1213-1220
		if recovery < 0 then break end -- L:1111 N:1214
		if not projected then -- X:3997-4007 S:169-178
			publish_frame_roots(management, interrupted) -- T:207,238 C:215,246 X:3997-4007 S:169-178
			projected = true -- X:3997-4007 S:169-178
		end
		collector.finish_epoch(management, collector.step_words, address, 0, root) -- L:1123 N:1226; retry starts at the original physical reservation
	end
	if projected then root_inputs.release_string_work(management) end -- X:4009-4013 S:180-184
	return out_of_memory + 1, 0, 0 -- L:1111 N:1214 E:43
end

-- The CPU supplies architectural extents (including its exception spare).
-- Rounding the two reservations is part of backing policy, not CALL decode.
local prepare_frame_space<const> = function(management, address, value_end, frame_end, root, source_cycles, interrupted) -- X:517-521 V:159-166 W:181-189
	local thread<const>: *thread_storage_record = layout.ram_base + (address & word_mask) -- V:161-164 W:183-188 H:21-22
	local frames = 0 -- X:4169-4176 Y:3207-3217; no change to frame backing for a Value-only request
	if frame_end ~= 0 then -- X:4169-4176 Y:3207-3217; a receiving window only reserves Values
		local previous_frames<const> = thread.frame_capacity & control_count_mask -- V:161,164 W:183,185,188 H:27
		frames = previous_frames < 2 and 2 or previous_frames -- V:161 W:185 H:17
		while frames < frame_end do frames = frames * 2 end -- V:162 W:186
		if frames == previous_frames then frames = 0 end -- V:164 W:188
	end
	local values = 0 -- X:519 V:163 W:187
	if value_end > thread.stack_capacity then -- X:518-519 V:163 W:187
		values = value_end <= 8 and 8 or 1 << (allocator.internal.highest_bit(value_end - 1) + 1) -- X:519 W:187 H:16
	end
	if values == 0 and frames == 0 then return 0 end -- V:159 W:181; no reservation required
	return (grow_thread_frame_storage(management, address, values, frames, root, source_cycles, interrupted)) -- V:166 W:189
end

local reserve_frame_space<const> = function(address, value_end, frame_end, root) -- X:517-521 V:159-166 W:181-189
	local management_port<const>: *u32 = layout.management_address -- T:227 A:25 C:234 B:20; ordinary resident context
	local cycles_port<const>: *u32 = layout.call_cycles_address -- X:5201-5207 Y:2809-2815; issuing allowance
	local fault_port<const>: *u32 = layout.call_fault_address -- L:1111 N:1214; ordinary resident fault
	local status<const> = prepare_frame_space(*management_port, address, value_end, frame_end, root, *cycles_port) -- V:166 W:189
	if status ~= 0 then *fault_port = status - 1 end -- L:1111 N:1214; same Lua exception, after rollback/recovery
	return -- V:166 W:189; acquisition has no language results
end

-- The firmware owns the root bank's next zero-based EXEC window.
local reserve_system_entry<const> = function(value_end) -- W:181-189; firmware admits the entry before EXEC
	local port<const>: *u32 = layout.management_address -- T:227 A:25 C:234 B:20
	local roots<const>: *root_descriptors = layout.ram_base + *port + layout.root_banks_offset -- X:5274; the root is already firmware-published
	reserve_frame_space(roots.root, value_end, 2, 0) -- W:182-189 V:159-166
end

return {
	internal = {
		update_charge = update_charge, resize_value_stack = resize_value_stack,
		grow_frame_controls = grow_frame_controls, value_planes = value_planes, active_call_frame = active_call_frame,
		publish_frame_roots = publish_frame_roots,
	},
	reserve_frame_storage = reserve_frame_storage, grow_thread_frame_storage = grow_thread_frame_storage,
	prepare_frame_space = prepare_frame_space, reserve_frame_space = reserve_frame_space,
	reserve_system_entry = reserve_system_entry,
}
