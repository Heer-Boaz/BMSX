-- A compiler scope for an ancestor pinned by its own thread's evaluation call.
-- Names/locations come from installed symbols, never copied guest values.
local running<const> = __bmsx_coroutine_running
local get_register<const> = __bmsx_get_frame_register
local set_register<const> = __bmsx_set_frame_register
local get_upvalue<const> = __bmsx_get_frame_upvalue
local set_upvalue<const> = __bmsx_set_frame_upvalue
local raise<const> = __bmsx_error

local frame<const> = {}

function frame.open(frame_index, names)
	local thread = running()
	return {
		names = names,
		read = function(location)
			if thread == nil then
				raise('Selected frame evaluation has ended.')
			end
			if location.upvalue then
				return get_upvalue(thread, frame_index, location.index)
			end
			return get_register(thread, frame_index, location.index)
		end,
		write = function(location, value)
			if thread == nil then
				raise('Selected frame evaluation has ended.')
			end
			if location.upvalue then
				set_upvalue(thread, frame_index, location.index, value)
			else
				set_register(thread, frame_index, location.index, value)
			end
		end,
		close = function()
			-- Escaped compiled closures retain the accessors, not a live stack borrow.
			thread = nil
		end,
	}
end

return frame
