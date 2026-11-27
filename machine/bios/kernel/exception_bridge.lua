module<const>

local frames<const> = require('kernel/thread_frame_storage')
local vectors<const> = require('bmsx/startup')
local layout<const> = require('kernel/gc_runtime_layout')
local operand_roots<const> = require('kernel/gc_operand_roots')
local trap<const> = 13 << 2
local control_count_mask<const> = (1 << 18) - 1
local frame_window_mask<const> = (1 << 20) - 1

local frame_width<const> = function(address)
	local entry<const>: *launch_function_record = address
	local width = entry.maximum
	if width < entry.formals then width = entry.formals end
	if width == 0 then width = 1 end
	return width
end

-- The fixed vector has no Closure. Root its tagged trap argument if this
-- transfer needs to collect in order to prepare the interrupted stack.
local prepare<const> = function(width, argument)
	local interrupted_port<const>: *addr = layout.interrupted_context_address
	local interrupted<const> = *interrupted_port
	local thread<const>: *thread_storage_record = interrupted
	local values<const> = (thread.stack_top & frame_window_mask) + width
	local depth<const> = (thread.frame_depth & control_count_mask) + 1
	if values <= thread.stack_capacity and depth <= (thread.frame_capacity & control_count_mask) then return end
	local management<const> = layout.management_offset
	local root = 0
	if argument then
		root = operand_roots.single_value_scope(management, thread.error_tag & 0xff, thread.error_word)
	end
	-- There is no issuing allocation allowance in the fixed vector. If
	-- backing remains unavailable the direct target cannot be entered.
	frames.prepare_frame_space(management, interrupted, values, depth, root, 0, true)
end

local enter<const> = function()
	prepare(frame_width(vectors.managed_exception), cop0.cause == trap)
	cop0.exception_target = vectors.managed_exception
end

return { enter = enter, prepare = prepare, frame_width = frame_width }
