module<const>

local layout<const> = require('kernel/gc_runtime_layout')
local records<const> = require('kernel/allocate_record')
local captured<const> = require('kernel/allocate_captured_closure')
local closure_index<const> = require('kernel/canonical_closure_index')
local _capture_layout<const> = require('kernel/closure_capture_create')
local frames<const> = require('kernel/thread_frame_storage').internal
local management<const> = layout.management_offset
local binding_address<const> = layout.ram_base + management + layout.function_binding_offset
local control_count_mask<const> = (1 << 18) - 1
local window_mask<const> = (1 << 20) - 1
local ram_word_mask<const> = 0x003ffffc
local closure_tag<const> = 7
local latched_prototype<const> = 8
local static_function<const> = 1 << 1
local out_of_memory<const> = 9

-- The Function record was already sampled on the issuing bus. Prepare the
-- closure from those words, not from a second read of the mutable record.
local bind<const> = function(owner, destination, prototype, domain, code, formals, stack, flags, descriptors, count, rom, deadline)
	local thread<const>: *stopped_thread = owner
	local depth<const> = thread.frame_depth & control_count_mask
	local frame_address<const> = layout.ram_base + ((thread.frame_block + (depth - 1) * sizeof(stopped_frame)) & ram_word_mask)
	local frame<const>: *stopped_frame = frame_address
	local canonical<const> = count == 0 and (flags & static_function) ~= 0
	local offset = 0
	if canonical then
		offset = closure_index.find(management + layout.control_offset, prototype, domain, code, formals, stack, flags, descriptors, count, rom)
	end
	if offset == 0 then
		if rom ~= 0 and count == 0 then
			local kind<const> = canonical and records.canonical_closure_kind or records.dynamic_closure_kind
			offset = records.allocate_record(management, kind, prototype, domain, records.direct_mode, deadline)
		else
			local binding<const>: *closure_binding = binding_address
			local binding_flags<const> = (rom == 0 and latched_prototype or 0) | (canonical and closure_index.canonical_flag or 0)
			binding.prototype, binding.domain, binding.binding_flags = prototype, domain, binding_flags
			binding.code, binding.params, binding.stack = code, formals, stack
			binding.flags, binding.descriptors, binding.count = flags, descriptors, count
			offset = captured.allocate_captured_closure(management, frame_address, owner, binding_address, descriptors, deadline)
		end
	end
	if offset <= 0 then
		return nil, offset == 0 and out_of_memory or ~offset
	end

	local words<const>, tags<const> = frames.value_planes(owner, (frame.stack_base & window_mask) + destination)
	local output_word<const>: *u32 = words
	local output_tag<const>: *u8 = tags
	*output_word, *output_tag = layout.ram_base + offset, closure_tag
	if (frame.top & window_mask) <= destination then
		frame.top = (frame.top & ~window_mask) | (destination + 1)
	end
	return frame.pc, nil
end

return { bind = bind }
