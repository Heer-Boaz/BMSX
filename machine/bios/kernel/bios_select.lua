module<const>

-- Source basis: e7fb351d4a4cba40b0fd089f3a5a347dfca97013.
-- C: cpu.cpp 1672–1694; T: cpu.ts 5021–5037. The caller's existing
-- variadic activation owns the arguments; VARARG and RET deliver the slice.
local layout<const> = require('kernel/gc_runtime_layout')
local frames<const> = require('kernel/thread_frame_storage')
local strings<const> = require('kernel/string_record')
local words<const> = require('kernel/word_arithmetic')

local integer_tag<const> = 3
local float_tag<const> = 4
local string_tag<const> = 5
local invalid_argument<const> = 10
local frame_window_mask<const> = 0x000fffff

local select_arguments<const> = function(selector)
	local management_port<const>: *u32 = layout.management_address
	local fault_port<const>: *u32 = layout.call_fault_address
	local management<const> = *management_port
	local cell_address<const> = layout.ram_base + management + layout.value_cell_offset
	local cell<const>: *value = cell_address
	local payload<const>: *u32 = cell_address
	local tag<const>: *u8 = cell_address + layout.value_cell_tag_offset
	*cell = selector
	local word<const>, kind<const> = *payload, *tag
	local _<const>, address<const> = frames.internal.active_call_frame(management)
	local frame<const>: *frame_record = address
	local count<const> = frame.vararg_count & frame_window_mask

	if kind == string_tag and strings.byte_length(word) == 1 and strings.byte_at(word, 0) == 35 then -- C:1673–1675 T:5026–5028
		return count
	end
	local start = word
	if kind == float_tag then -- C:1679 T:5030; exactly representable signed Integer
		local integer<const>, finite<const> = words.float_to_word(word)
		if not finite or selector ~= integer then *fault_port = invalid_argument; return nil end
		start = integer
	elseif kind ~= integer_tag then
		*fault_port = invalid_argument
		return nil
	end
	if start < 0 then start = count + start + 1 end -- C:1680 T:5031
	if start < 1 then start = 1 end
	if start > count then start = count + 1 end -- C:1681 T:5032
	local selected = count + 1 - start
	local requested<const> = frame.return_count & frame_window_mask
	if requested ~= 0 and selected >= requested then selected = requested - 1 end -- C:1692 T:5033, fixed receiving window
	frame.vararg_base = frame.vararg_base + start - 1
	frame.vararg_count = selected
	return nil
end

return { select_arguments = select_arguments }
