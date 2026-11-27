module<const>

-- Source basis: ef061266e: TS CPU 4638–4712, C++ CPU 1379–1450,
-- protected_return 127–140. A suspended transport frame retains the
-- result destination of its ordinary CALL. BIOS places the results once,
-- retires that frame and returns to its caller through RFE.
local layout<const> = require('kernel/gc_runtime_layout')
local frames<const> = require('kernel/thread_frame_storage')
local allocator<const> = require('kernel/dlmalloc')
local entries<const> = require('bmsx/startup')

local word_mask<const> = 0x003ffffc
local window_mask<const> = 0x000fffff
local control_count_mask<const> = 0x0003ffff
local extend_top<const> = 1 << 5
local maximum_values<const> = 0x00400000 // 5
local new<const>, running<const>, normal<const>, suspended<const>, dead<const>, failed<const> = 0, 1, 2, 3, 4, 5
local false_tag<const>, true_tag<const>, string_tag<const>, closure_tag<const> = 1, 2, 5, 7
local out_of_memory<const>, invalid_argument<const> = 9, 10

rodata resume_refusal: string[1] = { 'cannot resume non-suspended coroutine' }

-- Same physical Value planes on both sides of the transfer. A copy is
-- between distinct Thread backings, and follows any receiving relocation.
local copy_values<const> = function(source, first, output_word_address, output_tag_address, count)
	local input_word_address<const>, input_tag_address<const> = frames.internal.value_planes(source, first)
	local input_words<const>: *u32 = input_word_address
	local input_tags<const>: *u8 = input_tag_address
	local output_words<const>: *u32 = output_word_address
	local output_tags<const>: *u8 = output_tag_address
	for i = 0, count - 1 do
		output_words[i] = input_words[i]
		output_tags[i] = input_tags[i]
	end
end

-- Apply the transport frame's ordinary RET placement directly in its
-- caller. Status zero is a transfer to a suspended yield; otherwise
-- place the status before the values. A diagnostic is a single raw Value.
local deliver<const> = function(destination, source, first, supplied, status, payload, tag, deadline) -- TS:4647–4657,4708 C++:1387–1397,1445–1447
	local context<const>: *stopped_thread = destination
	local depth<const> = (context.frame_depth & control_count_mask) - 1
	local block<const>: *stopped_frame = layout.ram_base + (context.frame_block & word_mask)
	local transport<const>: *stopped_frame = &block[depth]
	local caller<const>: *stopped_frame = &block[depth - 1]
	local prepend<const> = status ~= 0 and 1 or 0
	local available<const> = supplied + prepend
	local wanted<const> = transport.return_count & window_mask
	local count<const> = wanted == 0 and available or wanted - 1
	local base<const> = transport.return_base & window_mask
	local stop<const> = base + count
	local stack_base<const> = caller.stack_base & window_mask
	local width = caller.stack_capacity & window_mask
	if count ~= 0 then
		if stop > width then
			if stop > maximum_values - stack_base then return nil end
			width = stop <= 8 and 8 or 1 << (allocator.internal.highest_bit(stop - 1) + 1)
			local extent<const> = stack_base + width
			if extent > maximum_values then return nil end
			if extent > context.stack_capacity then
				if frames.prepare_frame_space(layout.management_offset, destination, extent, 0, 0, deadline, true) ~= 0 then
					return nil
				end
			end
			caller.stack_capacity = (caller.stack_capacity & ~window_mask) | width
		end
		local word_address<const>, tag_address<const> = frames.internal.value_planes(destination, stack_base + base)
		local words<const>: *u32 = word_address
		local tags<const>: *u8 = tag_address
		if prepend ~= 0 then words[0], tags[0] = 0, status end
		local copied<const> = supplied < count - prepend and supplied or count - prepend
		if copied ~= 0 then
			if source == 0 then words[prepend], tags[prepend] = payload, tag
			else copy_values(source, first, word_address + prepend * 4, tag_address + prepend, copied) end
		end
		for i = prepend + copied, count - 1 do words[i], tags[i] = 0, 0 end
	end
	if (transport.flags & extend_top) == 0 or stop > (caller.top & window_mask) then
		caller.top = (caller.top & ~window_mask) | stop
	end
	context.stack_top, context.frame_depth = stack_base + width, depth
	return caller.pc
end

local fail<const> = function(interrupted, raised, tag, deadline) -- protected_return:127–140
	local source<const>: *stopped_thread = interrupted
	local destination<const> = source.resumer
	if destination == 0 then return nil, nil end
	local context<const>: *stopped_thread = destination
	source.status = failed
	source.error_word, source.error_kind = raised, tag
	context.status = running
	local pc<const> = deliver(destination, 0, 0, 1, false_tag, raised, tag, deadline)
	if not pc then return nil, nil end
	source.resumer = 0
	return pc, destination
end

local first_resume<const> = function(interrupted, target, first, count) -- TS:4699–4704 C++:1434–1442; install the ordinary entry wrapper
	local context<const>: *stopped_thread = target
	local fn<const> = entries.coroutine_entry
	local prototype<const>: *system_entry_record = fn
	local base<const> = count + 1
	local extent<const> = base + prototype.maximum
	if extent > maximum_values then return nil end
	if extent > context.stack_capacity or (context.frame_capacity & control_count_mask) < 2 then
		if frames.prepare_frame_space(layout.management_offset, target, extent, 2, context.entry, 0, true) ~= 0 then return nil end
	end
	local word_address<const>, tag_address<const> = frames.internal.value_planes(target, 1)
	if count ~= 0 then copy_values(interrupted, first, word_address, tag_address, count) end
	local word<const>: *u32 = word_address + 4 * count
	local tag<const>: *u8 = tag_address + count
	*word, *tag = context.entry, closure_tag
	local frame<const>: *stopped_frame = context.frame_block
	frame.fn, frame.call_site, frame.head, frame.flags = fn, 0, 0, 0
	frame.pc, frame.vararg_base, frame.argument_count = prototype.code, 1, base
	frame.return_base, frame.return_count, frame.top, frame.closure = 0, 0, 1, 0
	frame.stack_base, frame.stack_capacity = base, prototype.maximum
	context.stack_top, context.frame_depth = extent, 1
	context.entry = 0
	return prototype.code
end

local resume<const> = function(interrupted, frame_address, target) -- TS:4676–4711 C++:1412–1449
	local source<const>: *stopped_thread = interrupted
	local destination<const>: *stopped_thread = target
	local status<const> = destination.status
	if status ~= new and status ~= suspended then
		local header<const>: *addr = 32
		local image<const>: *boot_image = *header
		local constants<const>: *constant_record = image.constants
		local ordinal<const>: *u32 = &resume_refusal[0]
		local pc<const> = deliver(interrupted, 0, 0, 1, false_tag, constants[*ordinal].word, string_tag, 0)
		if not pc then return nil, interrupted, out_of_memory end
		return pc, interrupted, nil
	end
	local frame<const>: *stopped_frame = frame_address
	local first<const> = frame.vararg_base & window_mask
	local base<const> = frame.stack_base & window_mask
	local count<const> = base - first
	source.status = normal
	destination.resumer, destination.status = interrupted, running
	local pc
	if status == new then pc = first_resume(interrupted, target, first, count)
	else pc = deliver(target, interrupted, first, count, 0, 0, 0, 0) end
	if pc then return pc, target, nil end
	local diagnostics<const>: *startup_root_head = layout.ram_base + layout.management_offset + layout.remark_head_offset
	local faults<const>: *u32 = diagnostics.fault_ids
	local resume_pc<const>, owner<const> = fail(target, faults[out_of_memory], string_tag, 0)
	if resume_pc then return resume_pc, owner, nil end
	return nil, interrupted, out_of_memory
end

local return_to_resumer<const> = function(interrupted, first, count, finished)
	local source<const>: *stopped_thread = interrupted
	local destination<const> = source.resumer
	if destination == 0 then return nil, interrupted, invalid_argument end
	local context<const>: *stopped_thread = destination
	source.status = finished and dead or suspended
	context.status = running
	local pc<const> = deliver(destination, interrupted, first, count, true_tag, 0, 0, 0)
	if not pc then return nil, destination, out_of_memory end
	source.resumer = 0
	if finished then source.stack_top, source.frame_depth = 0, 0 end
	return pc, destination, nil
end

local yield<const> = function(interrupted, frame_address) -- TS:4643–4661,4669–4674 C++:1383–1400,1405–1410
	local frame<const>: *stopped_frame = frame_address
	local first<const> = frame.vararg_base & window_mask
	local base<const> = frame.stack_base & window_mask
	local pc<const>, destination<const>, reason<const> = return_to_resumer(interrupted, first, base - first, false)
	return pc, destination, reason
end

local finish<const> = function(interrupted, frame_address, first)
	local frame<const>: *stopped_frame = frame_address
	local base<const> = frame.stack_base & window_mask
	local top<const> = frame.top & window_mask
	local pc<const>, destination<const>, reason<const> = return_to_resumer(interrupted, base + first, top - first, true)
	return pc, destination, reason
end

return {
	resume = resume, yield = yield, finish = finish, fail = fail,
	internal = { copy_values = copy_values, deliver = deliver, first_resume = first_resume, return_to_resumer = return_to_resumer },
}
