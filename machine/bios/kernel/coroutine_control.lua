module<const>

local ids<const> = require('kernel/coroutine_control_ids')
local layout<const> = require('kernel/gc_runtime_layout')
local types<const> = require('kernel/value_type')
local frames<const> = require('kernel/thread_frame_storage')
local creation<const> = require('kernel/thread_create')
local retirement<const> = require('kernel/coroutine_close')
local captures<const> = require('kernel/frame_upvalue')
local yieldable<const> = require('kernel/coroutine_yieldable')
local count_mask<const> = (1 << 18) - 1
local window_mask<const> = (1 << 20) - 1
local word_mask<const> = 0x003ffffc
local invalid_argument<const> = 10

local receive<const> = function(owner, token, destination, count, protected_handler)
	local expected<const> = token == ids.set_frame_upvalue and 4 or 1
	if destination == nil or count ~= expected then return invalid_argument end

	local context<const>: *stopped_thread = owner
	local depth<const> = context.frame_depth & count_mask
	local frame<const>: *stopped_frame = layout.ram_base + ((context.frame_block + (depth - 1) * sizeof(stopped_frame)) & word_mask)
	local position<const> = (frame.stack_base & window_mask) + destination
	local input_words<const>, input_tags<const> = frames.internal.value_planes(owner, position + 1)
	local arguments<const>: *u32 = input_words
	local kinds<const>: *u8 = input_tags
	if token == ids.create then
		local address<const>, fault<const> = creation.create_from_value(arguments[0], kinds[0], cop0.event_cycles)
		if fault ~= nil then return fault end
		-- Collection may have compacted the stopped context's backing.
		local result_words<const>, result_tags<const> = frames.internal.value_planes(owner, position)
		local result<const>: *u32 = result_words
		local tag<const>: *u8 = result_tags
		*result, *tag = address, types.thread_tag
	elseif token == ids.close then
		local closed<const>, error_word<const>, error_tag<const>, fault<const> = retirement.close_value(arguments[0], kinds[0])
		if fault ~= nil then return fault end
		local result<const>: *u32 = input_words - 4
		local tags<const>: *u8 = input_tags - 1
		result[0], tags[0] = 0, closed and types.true_tag or types.false_tag
		result[1], tags[1] = error_word, error_tag
		-- The fixed consumer reads Nil padding on success, while the open
		-- result extent still describes one success or two failure values.
		frame.top = (frame.top & ~window_mask) | (destination + (closed and 1 or 2))
	elseif token == ids.yieldable then
		if kinds[0] ~= types.thread_tag then return invalid_argument end
		local result<const>: *u32 = input_words - 4
		local tag<const>: *u8 = input_tags - 1
		*result, *tag = 0, yieldable(arguments[0], protected_handler) and types.true_tag or types.false_tag
	else
		local fault<const> = captures.store_value(arguments[0], kinds[0], arguments[1], kinds[1],
			arguments[2], kinds[2], arguments[3], kinds[3])
		return fault
	end
	return nil
end

return { receive = receive }
