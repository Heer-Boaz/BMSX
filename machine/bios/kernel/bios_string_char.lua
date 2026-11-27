module<const>

local layout<const> = require('kernel/gc_runtime_layout')
local strings<const> = require('kernel/allocate_string_slice')
local slices<const> = require('kernel/string_slice')
local frames<const> = require('kernel/thread_frame_storage')

local invalid_argument<const> = 10
local out_of_memory<const> = 9
local string_tag<const> = 5
local frame_window_mask<const> = 0x000fffff

-- The ordinary variadic BIOS caller already owns this argument window.
local intern_chars<const> = function()
	local management_port<const>: *u32 = layout.management_address
	local cycles_port<const>: *u32 = layout.call_cycles_address
	local fault_port<const>: *u32 = layout.call_fault_address
	local management<const> = *management_port
	local owner<const>, address<const> = frames.internal.active_call_frame(management)
	local frame<const>: *frame_record = address
	local first<const>, after<const> = frame.vararg_base & frame_window_mask, frame.stack_base & frame_window_mask
	local count<const> = after > first and after - first or 0
	local id<const>, fault<const> = strings.intern_value_window(management, owner, first, count, slices.chars_source, *cycles_port)
	if fault ~= 0 then *fault_port = invalid_argument; return nil end
	if id == 0 then *fault_port = out_of_memory; return nil end
	local cell_address<const> = layout.ram_base + management + layout.value_cell_offset
	local payload<const>: *u32 = cell_address
	local tag<const>: *u8 = cell_address + layout.value_cell_tag_offset
	local result<const>: *value = cell_address
	*payload = id
	*tag = string_tag
	return *result
end

return { intern_chars = intern_chars }
