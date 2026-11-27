module<const>

local layout<const> = require('kernel/gc_runtime_layout')
local frames<const> = require('kernel/thread_frame_storage')
local retire<const> = require('kernel/thread_retire')
local roots<const> = require('kernel/gc_operand_roots')
local coroutine_transfer<const> = require('kernel/coroutine_transfer')
local entries<const> = require('bmsx/startup')

local word_mask<const> = 0x003ffffc
local window_mask<const> = 0x000fffff
local control_count_mask<const> = 0x0003ffff
local exception_or_completion<const> = 3
local cartridge_bank<const> = 1 << 3
local string_tag<const> = 5

-- Replace the protected activation, preserving its return destination and
-- attributed call site. Both landing bodies return through ordinary RET.
local land<const> = function(interrupted, control_address, index, fn, raised, tag, deadline)
	local block<const>: *stopped_frame = control_address
	local thread<const>: *stopped_thread = interrupted
	local frame<const>: *stopped_frame = &block[index]
	local base<const> = frame.stack_base & window_mask
	local entry<const>: *system_entry_record = fn
	local width<const> = entry.maximum
	local end_slot<const> = base + width
	if end_slot > thread.stack_capacity then
		local scope<const> = roots.single_value_scope(layout.management_offset, tag, raised)
		if frames.prepare_frame_space(layout.management_offset, interrupted, end_slot, 0, scope, deadline, true) ~= 0 then return nil end
	end
	local words_address<const>, tags_address<const> = frames.internal.value_planes(interrupted, base)
	local words<const>: *u32 = words_address
	local tags<const>: *u8 = tags_address
	local argc = 1
	if fn == entries.protected_handler then
		local parent<const>: *stopped_frame = &block[index - 1]
		local word_address<const>, tag_address<const> = frames.internal.value_planes(interrupted, parent.vararg_base & window_mask)
		local handler_word<const>: *u32 = word_address
		local handler_tag<const>: *u8 = tag_address
		words[0], tags[0] = *handler_word, *handler_tag
		argc = 2
	end
	words[argc - 1], tags[argc - 1] = raised, tag
	frame.fn = fn
	frame.pc = entry.code
	frame.vararg_base = base
	frame.argument_count = argc
	frame.top = argc
	frame.stack_capacity = width
	thread.stack_top = end_slot
	return entry.code
end

local catch_fault<const> = function(interrupted, raised, tag, deadline)
	local context<const>: *stopped_thread = interrupted
	local depth<const> = context.frame_depth & control_count_mask
	local control_address<const> = layout.ram_base + (context.frame_block & word_mask)
	local block<const>: *stopped_frame = control_address
	for at = depth - 1, 0, -1 do
		local frame<const>: *stopped_frame = &block[at]
		if (frame.flags & exception_or_completion) ~= 0 then return false, nil, nil end
		if (frame.flags & cartridge_bank) == 0 then
			local fn<const> = frame.fn
			local xpcall_body = false
			-- A raw CLOSURE can name a ROM function by address. The
			-- protected body gets its handler only from its own wrapper.
			if fn == entries.protected_body and at ~= 0 then
				local parent<const>: *stopped_frame = &block[at - 1]
				xpcall_body = parent.fn == entries.protected_xcall and (parent.flags & cartridge_bank) == 0
			end
			if fn == entries.protected_call or xpcall_body or fn == entries.protected_handler then
				local control<const> = layout.management_offset + layout.control_offset
				local arena<const> = layout.management_offset + layout.arena_offset
				retire.retire_thread_frames(control, arena, interrupted, at + 1)
				if fn == entries.protected_call then
					local pc<const> = land(interrupted, control_address, at, entries.protected_failure, raised, tag, deadline)
					return pc ~= nil, pc, nil
				end
				if xpcall_body then
					local pc<const> = land(interrupted, control_address, at, entries.protected_handler, raised, tag, deadline)
					if pc then return true, pc, nil end
				end
				local diagnostics<const>: *startup_root_head = layout.ram_base + layout.management_offset + layout.remark_head_offset
				local pc<const> = land(interrupted, control_address, at, entries.protected_failure, diagnostics.error, string_tag, deadline)
				return pc ~= nil, pc, nil
			end
		end
	end

	local pc<const>, resumer<const> = coroutine_transfer.fail(interrupted, raised, tag, deadline)
	return pc ~= nil, pc, resumer
end

return { catch_fault = catch_fault, internal = { land = land } }
