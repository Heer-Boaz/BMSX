-- A compiler scope for an ancestor pinned by its own thread's evaluation call.
-- Names/locations come from installed symbols, never copied guest values.
local running<const> = __bmsx_coroutine_running
local get_register<const> = __bmsx_get_frame_register
local set_register<const> = __bmsx_set_frame_register
local get_upvalue<const> = __bmsx_get_frame_upvalue
local set_upvalue<const> = __bmsx_set_frame_upvalue
local frame_header<const> = __bmsx_frame_header
local frame_count<const> = __bmsx_frame_count
local scopes<const> = require('debug/scopes')
local cart_select<const>: *word = 0x08010420
local raise<const> = __bmsx_error

local frame<const> = {}

-- Resolve the selected ancestor at its actual suspension, not the evaluator's PC.
function frame.resolve(frame_index, inline_depth)
	local thread<const> = running()
	local function_address<const>, pc, _<const>, _<const>, domain<const> = frame_header(thread, frame_index)
	if frame_index + 1 < frame_count(thread) then
		local _<const>, _<const>, call_site<const>, completion<const> = frame_header(thread, frame_index + 1)
		if not completion then
			pc = call_site
		end
	end
	local rom_base = 0
	if domain ~= 0xffffffff then
		if *cart_select & 1 ~= domain then
			return nil, 'Frame cartridge is not mapped on the data bus.'
		end
		rom_base = 0x10000000
	end
	return scopes.resolve(rom_base, function_address, pc, inline_depth)
end

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
