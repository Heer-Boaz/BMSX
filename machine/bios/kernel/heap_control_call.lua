module<const>

local ids<const> = require('kernel/heap_control_ids')
local layout<const> = require('kernel/gc_runtime_layout')
local tags<const> = require('kernel/value_type')
local frames<const> = require('kernel/thread_frame_storage')
local gc<const> = require('kernel/gc_full')
local step<const> = require('kernel/gc_collect_step')
local floor<const> = require('kernel/heap_floor')
local bindings<const> = require('kernel/system_image_bind')
local live_binding<const> = require('kernel/live_image_bind')
local tables<const> = require('kernel/bios_create_table')
local retire<const> = require('kernel/thread_retire')
local control_count_mask<const> = (1 << 18) - 1
local window_mask<const> = (1 << 20) - 1
local word_mask<const> = 0x003ffffc
local completion_frame<const> = 1
local cartridge_bank<const> = 1 << 3
local previous_user_mode<const> = 1 << 3
local invalid_argument<const> = 10

-- The original operand/result window belongs to the stopped frame.
-- The software identifies its operations; the CPU only takes the trap.
local receive<const> = function(owner, token, destination, count)
	if token == ids.collect_full then
		if destination ~= nil then return invalid_argument end
		gc.collect_full()
		return nil
	end
	if destination == nil then return invalid_argument end

	local context<const>: *stopped_thread = owner
	local depth<const> = context.frame_depth & control_count_mask
	local frame<const>: *stopped_frame = layout.ram_base + ((context.frame_block + (depth - 1) * sizeof(stopped_frame)) & word_mask)
	local slot<const> = (frame.stack_base & window_mask) + destination
	local result_word, result_tag = 0, tags.integer_tag
	if token == ids.create_table then
		if count ~= 2 then return invalid_argument end
		local words<const>, kinds<const> = frames.internal.value_planes(owner, slot + 1)
		local hints<const>: *u32 = words
		local hint_kinds<const>: *u8 = kinds
		if hint_kinds[0] ~= tags.integer_tag or hint_kinds[1] ~= tags.integer_tag then
			return invalid_argument
		end
		local address<const>, reason<const> = tables.create_table(hints[0], hints[1])
		if reason ~= nil then return reason end
		result_word, result_tag = address, tags.table_tag
	elseif token == ids.bind_live_image then
		-- Publishing an executable bank belongs to a stopped loader, not
		-- to an ordinary cartridge CALL of the same System address.
		if (frame.flags & (completion_frame | cartridge_bank)) ~= completion_frame or count ~= 6 then
			return invalid_argument
		end
		local arguments<const>: *u32 = frames.internal.value_planes(owner, slot + 1)
		result_word = live_binding.bind_live(arguments)
	elseif token < ids.admit_floor then
		if count ~= 0 then return invalid_argument end
		if token == ids.collect_step then
			local finished<const> = step.collect_step()
			result_tag = finished and tags.true_tag or tags.false_tag
		else
			local used<const>, capacity<const> = gc.heap_bytes()
			result_word = token == ids.heap_count and used or capacity
		end
	else
		-- A user or cartridge procedure cannot set the private floor or
		-- install backing by issuing the same token.
		if (frame.flags & cartridge_bank) ~= 0 or (cop0.status & previous_user_mode) ~= 0 then
			return invalid_argument
		end
		local arguments<const>: *u32 = frames.internal.value_planes(owner, slot + 1)
		if token == ids.admit_floor then
			result_word = floor.admit_static_end(arguments[0])
		elseif token == ids.bind_cartridge then
			result_word = bindings.bind_cartridge(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4], arguments[5], owner)
		else
			local status<const> = frames.prepare_frame_space(layout.management_offset, owner, arguments[0], 2, 0, cop0.event_cycles)
			if status ~= 0 then return status - 1 end
			retire.prepare_exec(layout.management_offset, owner)
			return nil
		end
	end

	-- The boot leaves may move physical Value and Frame backing.
	local result_words<const>, result_tags<const> = frames.internal.value_planes(owner, slot)
	local output<const>: *u32 = result_words
	local kind<const>: *u8 = result_tags
	*output, *kind = result_word, result_tag
	local saved<const>: *stopped_frame = layout.ram_base + ((context.frame_block + (depth - 1) * sizeof(stopped_frame)) & word_mask)
	if token == ids.create_table or (saved.top & window_mask) <= destination then
		saved.top = (saved.top & ~window_mask) | (destination + 1)
	end
	return nil
end

return { receive = receive }
