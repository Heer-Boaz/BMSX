module<const>

-- Source basis: f3872c7d1. CPU::handleProtectedCallError, unwindToDepth
-- and finishProtectedCallWithError; FrameField and ProtectedField RAM layout.
-- On entry the machine is executing on the fixed System vector, so the
-- interrupted context can be changed without running any of its frames.
local layout<const> = require('kernel/gc_runtime_layout')
local frames<const> = require('kernel/thread_frame_storage')
local retire<const> = require('kernel/thread_retire')
local allocator<const> = require('kernel/dlmalloc')
local roots<const> = require('kernel/gc_operand_roots')
local vectors<const> = require('bmsx/startup')

local word_mask<const> = 0x003ffffc
local window_mask<const> = 0x000fffff
local control_count_mask<const> = 0x0003ffff
local exception_or_completion<const> = 3
local cartridge_bank<const> = 1 << 3
local extend_top<const> = 1 << 31
local protected_kind_mask<const> = 0xff
local protected_parent<const> = 1 << 8
local protected_builtin<const> = 1 << 9
local protected_resident<const> = 1 << 10
local xpcall_body<const> = 1
local xpcall_handler<const> = 2
local out_of_memory<const> = 9
local running<const>, failed<const> = 1, 5
local false_tag<const> = 1
local true_tag<const> = 2
local string_tag<const> = 5
local closure_tag<const> = 7
local builtin_tag<const> = 8
local resident_tag<const> = 11

struct protected_result_record
	flags: u32
	caller: u32
	base: u32
	wanted: u32
	handler: addr
end

-- Source is either one incoming tagged value or a result span already in
-- the retained caller. Its physical source must survive any backing move.
local place_outcome<const> = function(thread, frame, base, wanted, succeeded, source, available, payload, tag, deadline)
	local context<const>: *stopped_thread = thread
	local destination<const>: *stopped_frame = frame
	local encoded<const> = wanted & ~extend_top
	local count<const> = encoded == 0 and available + 1 or encoded - 1
	local stack_base<const> = destination.stack_base & window_mask
	local stop<const> = base + count
	if count ~= 0 and stop > (destination.stack_capacity & window_mask) then
		local capacity<const> = stop <= 8 and 8 or 1 << (allocator.internal.highest_bit(stop - 1) + 1)
		local extent<const> = stack_base + capacity
		if extent > context.stack_capacity then
			local scope = 0
			if not source then scope = roots.single_value_scope(layout.management_offset, tag, payload) end
			local status<const> = frames.prepare_frame_space(layout.management_offset, thread, extent, 0, scope, deadline, true)
			if status ~= 0 then return nil end
		end
		destination.stack_capacity = (destination.stack_capacity & ~window_mask) | capacity
		context.stack_top = extent
	end
	if count ~= 0 then
		local word_address<const>, tag_address<const> = frames.internal.value_planes(thread, stack_base + base)
		local words<const>: *u32 = word_address
		local tags<const>: *u8 = tag_address
		local copied<const> = available < count - 1 and available or count - 1
		if copied ~= 0 then
			if source then
				local from_word<const>, from_tag<const> = frames.internal.value_planes(thread, stack_base + source)
				local source_words<const>: *u32 = from_word
				local source_tags<const>: *u8 = from_tag
				-- Like ValuePlacement, move before writing the success slot if
				-- the nested protected call already used the caller's window.
				if base + 1 > source then
					for i = copied - 1, 0, -1 do
						words[i + 1] = source_words[i]
						tags[i + 1] = source_tags[i]
					end
				else
					for i = 0, copied - 1 do
						words[i + 1] = source_words[i]
						tags[i + 1] = source_tags[i]
					end
				end
			else
				words[1] = payload
				tags[1] = tag
			end
		end
		words[0] = 0
		tags[0] = succeeded and true_tag or false_tag
		for slot = copied + 1, count - 1 do
			words[slot] = 0
			tags[slot] = 0
		end
	end
	if (wanted & extend_top) == 0 or stop > (destination.top & window_mask) then
		destination.top = (destination.top & ~window_mask) | stop
	end
	return count
end

-- finishProtectedCallWithError, finishImplicitProtectedHandler and
-- finishProtectedContinuation. A nested protected builtin completes into
-- its parent without running any of the retained ordinary frames here.
local finish_protected_chain<const> = function(thread, frame, index, payload, tag, deadline)
	local context<const>: *stopped_thread = thread
	local destination<const>: *stopped_frame = frame
	local continuations<const>: *protected_result_record = layout.ram_base + (context.protected_block & word_mask)
	local position, word, kind = index, payload, tag
	local source, available, succeeded = nil, 1, false
	while true do
		local continuation<const>: *protected_result_record = &continuations[position]
		local flags<const>, base<const>, wanted<const> = continuation.flags, continuation.base, continuation.wanted
		local parent<const> = (flags & protected_parent) ~= 0
		if succeeded and (flags & protected_kind_mask) == xpcall_handler then
			if source then
				local word_address<const>, tag_address<const> = frames.internal.value_planes(thread, (destination.stack_base & window_mask) + source)
				local first_word<const>: *u32 = word_address
				local first_tag<const>: *u8 = tag_address
				if available ~= 0 then word, kind = *first_word, *first_tag else word, kind = 0, 0 end
			end
			source, available, succeeded = nil, 1, false
		end
		if parent and (wanted & extend_top) ~= 0 then
			word, kind = 0, succeeded and true_tag or false_tag
			source, available = nil, 1
		else
			local count<const> = place_outcome(thread, frame, base, wanted, succeeded, source, available, word, kind, deadline)
			if not count then return false end
			source, available = base, count
		end
		context.protected_depth = position
		if not parent then return true end
		position = position - 1
		succeeded = true
	end
end

-- The retained caller owns the result placement. The handler's ordinary
-- activation has no native protected-return marker and can run across grants.
local enter_handler<const> = function(interrupted, continuation_address, issue_pc, raised, tag, deadline)
	local context<const>: *stopped_thread = interrupted
	local continuation<const>: *protected_result_record = continuation_address
	local depth<const> = context.frame_depth & control_count_mask
	local fn<const> = vectors.protected_handler
	local body<const>: *system_entry_record = fn
	local base<const> = context.stack_top & window_mask
	local width<const> = body.maximum
	if base + width > context.stack_capacity or depth + 1 > (context.frame_capacity & control_count_mask) then
		local scope<const> = roots.single_value_scope(layout.management_offset, tag, raised)
		if frames.prepare_frame_space(layout.management_offset, interrupted, base + width, depth + 1, scope, deadline, true) ~= 0 then
			return nil
		end
	end
	local flags<const> = continuation.flags
	local handler_tag = closure_tag
	if (flags & protected_builtin) ~= 0 then handler_tag = builtin_tag end
	if (flags & protected_resident) ~= 0 then handler_tag = resident_tag end
	local address<const> = layout.ram_base + ((context.frame_block + depth * sizeof(stopped_frame)) & word_mask)
	local frame<const>: *stopped_frame = address
	frame.fn = fn
	frame.call_site = issue_pc
	frame.head = 0
	frame.protected = -1
	frame.flags = 0
	frame.pc = body.code
	frame.vararg_base = base
	frame.argument_count = 2
	frame.return_base = 0
	frame.return_count = 1
	frame.top = 2
	frame.closure = 0
	frame.stack_base = base
	frame.stack_capacity = width
	local word_address<const>, tag_address<const> = frames.internal.value_planes(interrupted, base)
	local words<const>: *u32 = word_address
	local tags<const>: *u8 = tag_address
	words[0] = continuation.handler
	tags[0] = handler_tag
	words[1] = raised
	tags[1] = tag
	continuation.flags = (flags & ~protected_kind_mask) | xpcall_handler
	context.stack_top = base + width
	context.frame_depth = depth + 1
	return body.code
end

local finish_handler<const> = function(interrupted, result)
	local context<const>: *stopped_thread = interrupted
	local depth<const> = context.frame_depth & control_count_mask
	local frame<const>: *stopped_frame = layout.ram_base + ((context.frame_block + (depth - 1) * sizeof(stopped_frame)) & word_mask)
	-- Other software calls do not carry a protected result. This is the ROM
	-- activation we published, not an operation number supplied by a cart.
	if frame.fn ~= vectors.protected_handler or (frame.flags & cartridge_bank) ~= 0 then return nil end
	local continuations<const>: *protected_result_record = layout.ram_base + (context.protected_block & word_mask)
	local index<const> = (context.protected_depth & control_count_mask) - 1
	local continuation<const>: *protected_result_record = &continuations[index]
	local target<const> = continuation.caller + 1
	local cell_address<const> = layout.ram_base + layout.management_offset + layout.value_cell_offset
	local cell<const>: *value = cell_address
	local word<const>: *u32 = cell_address
	local tag<const>: *u8 = cell_address + layout.value_cell_tag_offset
	*cell = result
	local payload<const>, kind<const> = *word, *tag
	local control<const> = layout.management_offset + layout.control_offset
	local arena<const> = layout.management_offset + layout.arena_offset
	retire.retire_thread_frames(control, arena, interrupted, target)
	local destination<const>: *stopped_frame = layout.ram_base + ((context.frame_block + (target - 1) * sizeof(stopped_frame)) & word_mask)
	if not finish_protected_chain(interrupted, destination, index, payload, kind, 0) then return nil end
	return destination.pc
end

local catch_window_oom<const> = function(interrupted, deadline)
	local context<const>: *stopped_thread = interrupted
	local depth<const> = context.frame_depth & control_count_mask
	local protected_depth<const> = context.protected_depth & control_count_mask
	local diagnostics<const>: *startup_root_head = layout.ram_base + layout.management_offset + layout.remark_head_offset
	local fault_ids<const>: *u32 = diagnostics.fault_ids
	local diagnostic<const> = fault_ids[out_of_memory]
	local control_block<const>: *stopped_frame = layout.ram_base + (context.frame_block & word_mask)
	if protected_depth ~= 0 then
		local continuations<const>: *protected_result_record = layout.ram_base + (context.protected_block & word_mask)
		local index<const> = protected_depth - 1
		local continuation<const>: *protected_result_record = &continuations[index]
		local target<const>, flags<const> = continuation.caller + 1, continuation.flags
		if target > depth then return false, nil, nil end
		local kind<const> = flags & protected_kind_mask
		for at = depth - 1, target, -1 do
			if (control_block[at].flags & exception_or_completion) ~= 0 then return false, nil, nil end
		end

		local control<const> = layout.management_offset + layout.control_offset
		local arena<const> = layout.management_offset + layout.arena_offset
		retire.retire_thread_frames(control, arena, interrupted, target)
		local destination<const>: *stopped_frame = &control_block[target - 1]
		if kind == xpcall_body then
			local handler_pc<const> = enter_handler(interrupted, continuation, destination.pc, diagnostic, string_tag, deadline)
			if handler_pc then return true, handler_pc, nil end
		end
		local payload<const> = kind == 0 and diagnostic or diagnostics.error
		if not finish_protected_chain(interrupted, destination, index, payload, string_tag, deadline) then
			return false, nil, nil
		end
		return true, destination.pc, nil
	end

	-- No protected call in this bank: propagate to the resumer without
	-- retiring the failed frames. A later coroutine.close still owns them.
	if context.resumer == 0 then return false, nil, nil end
	for at = depth - 1, 0, -1 do
		if (control_block[at].flags & exception_or_completion) ~= 0 then return false, nil, nil end
	end
	local resumer_address<const> = layout.ram_base + (context.resumer & word_mask)
	local resumer<const>: *stopped_thread = resumer_address
	local resumer_depth<const> = resumer.frame_depth & control_count_mask
	local destination<const>: *stopped_frame = layout.ram_base + ((resumer.frame_block + (resumer_depth - 1) * sizeof(stopped_frame)) & word_mask)
	context.status = failed
	context.error_word = diagnostic
	context.error_kind = string_tag
	resumer.status = running
	if not place_outcome(resumer_address, destination, resumer.call_base, resumer.return_count, false, nil, 1, diagnostic, string_tag, deadline) then
		return false, nil, nil
	end
	context.resumer = 0
	return true, destination.pc, resumer_address
end

return {
	catch_window_oom = catch_window_oom, finish_handler = finish_handler,
	internal = { place_outcome = place_outcome, finish_protected_chain = finish_protected_chain, enter_handler = enter_handler },
}
