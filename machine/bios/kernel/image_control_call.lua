module<const>

local ids<const> = require('kernel/heap_control_ids')
local layout<const> = require('kernel/gc_runtime_layout')
local tags<const> = require('kernel/value_type')
local frames<const> = require('kernel/thread_frame_storage')
local floor<const> = require('kernel/heap_floor')
local bindings<const> = require('kernel/system_image_bind')
local live_binding<const> = require('kernel/live_image_bind')
local retire<const> = require('kernel/thread_retire')
local control_count_mask<const> = (1 << 18) - 1
local window_mask<const> = (1 << 20) - 1
local word_mask<const> = 0x003ffffc
local completion_frame<const> = 1
local cartridge_bank<const> = 1 << 3
local previous_user_mode<const> = 1 << 3
local invalid_argument<const> = 10

local receive<const> = function(owner, token, destination, count)
	if destination == nil then return invalid_argument end
	local context<const>: *stopped_thread = owner
	local depth<const> = context.frame_depth & control_count_mask
	local frame<const>: *stopped_frame = layout.ram_base + ((context.frame_block + (depth - 1) * sizeof(stopped_frame)) & word_mask)
	local slot<const> = (frame.stack_base & window_mask) + destination

	if token == ids.bind_live_image then
		-- An executable bank is published by a stopped loader, not by
		-- a cartridge calling the same System address.
		if (frame.flags & (completion_frame | cartridge_bank)) ~= completion_frame or count ~= 6 then
			return invalid_argument
		end
	elseif (frame.flags & cartridge_bank) ~= 0 or (cop0.status & previous_user_mode) ~= 0 then
		return invalid_argument
	end

	local arguments<const>: *u32 = frames.internal.value_planes(owner, slot + 1)
	local result
	if token == ids.bind_live_image then
		result = live_binding.bind_live(arguments)
	elseif token == ids.admit_floor then
		result = floor.admit_static_end(arguments[0])
	elseif token == ids.bind_cartridge then
		result = bindings.bind_cartridge(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4], arguments[5], owner)
	else
		local status<const> = frames.prepare_frame_space(layout.management_offset, owner, arguments[0], 2, 0, cop0.event_cycles)
		if status ~= 0 then return status - 1 end
		retire.prepare_exec(layout.management_offset, owner)
		return nil
	end

	-- Image admission can move the physical Value and Frame backing.
	local words<const>, kinds<const> = frames.internal.value_planes(owner, slot)
	local output<const>: *u32 = words
	local kind<const>: *u8 = kinds
	*output, *kind = result, tags.integer_tag
	local saved<const>: *stopped_frame = layout.ram_base + ((context.frame_block + (depth - 1) * sizeof(stopped_frame)) & word_mask)
	if (saved.top & window_mask) <= destination then
		saved.top = (saved.top & ~window_mask) | (destination + 1)
	end
	return nil
end

return { receive = receive }
