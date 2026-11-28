module<const>

local layout<const> = require('kernel/gc_runtime_layout')
local records<const> = require('kernel/allocate_record')
local captured<const> = require('kernel/allocate_captured_closure')
local closure_index<const> = require('kernel/canonical_closure_index')
local _capture_layout<const> = require('kernel/closure_capture_create')
local frames<const> = require('kernel/thread_frame_storage').internal
local tags<const> = require('kernel/value_type')
local management<const> = layout.management_offset
local binding_address<const> = layout.ram_base + management + layout.function_binding_offset
local control_count_mask<const> = (1 << 18) - 1
local window_mask<const> = (1 << 20) - 1
local ram_word_mask<const> = 0x003ffffc
local closure_tag<const> = 7
local latched_prototype<const> = 8
local static_function<const> = 1 << 1
local out_of_memory<const> = 9
local invalid_argument<const> = 10
local cartridge_bank<const> = 1 << 3
local second_socket_shift<const> = 4
local ordinary_ram_start<const> = 0x08040000

-- The Function record was already sampled on the issuing bus. Prepare the
-- closure from those words, not from a second read of the mutable record.
local bind<const> = function(owner, frame_address, destination, prototype, domain, code, formals, stack, flags, descriptors, count, rom, deadline)
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
		return offset == 0 and out_of_memory or ~offset
	end

	local words<const>, kinds<const> = frames.value_planes(owner, (frame.stack_base & window_mask) + destination)
	local output_word<const>: *u32 = words
	local output_tag<const>: *u8 = kinds
	*output_word, *output_tag = layout.ram_base + offset, closure_tag
	return nil
end

-- Sample a runtime-linked Function on the issuer's bus before reserving
-- any storage. The allocator keeps this sample across GC.
local receive_ram<const> = function(owner, destination, count, deadline)
	if count ~= 1 then return invalid_argument end
	local thread<const>: *stopped_thread = owner
	local depth<const> = thread.frame_depth & control_count_mask
	local frame<const>: *stopped_frame = layout.ram_base + ((thread.frame_block + (depth - 1) * sizeof(stopped_frame)) & ram_word_mask)
	local words<const>, kinds<const> = frames.value_planes(owner, (frame.stack_base & window_mask) + destination + 1)
	local address<const>: *u32 = words
	local kind<const>: *u8 = kinds
	local prototype<const>, ram_end<const> = *address, cop0.ram_end
	-- The vector must not turn a RAM binding into a ROM entry or MMIO read.
	if *kind ~= tags.integer_tag or prototype < ordinary_ram_start
		or prototype > ram_end - sizeof(launch_function_record) or (prototype & 15) ~= 0 then
		return invalid_argument
	end
	local code<const> = blua32.context_word(prototype + offsetof(launch_function_record.code))
	if code < ordinary_ram_start or code >= ram_end then return invalid_argument end
	local formals<const> = blua32.context_word(prototype + offsetof(launch_function_record.formals))
	local stack<const> = blua32.context_word(prototype + offsetof(launch_function_record.maximum))
	local flags<const> = blua32.context_word(prototype + offsetof(launch_function_record.flags))
	local descriptors<const> = blua32.context_word(prototype + offsetof(launch_function_record.captures))
	local captures<const> = blua32.context_word(prototype + offsetof(launch_function_record.capture_count))
	local domain<const> = (frame.flags & cartridge_bank) == 0 and -1 or ((frame.flags >> second_socket_shift) & 1)
	local fault<const> = bind(owner, frame, destination, prototype, domain, code, formals, stack, flags, descriptors, captures, 0, deadline)
	if fault == nil then
		frame.top = (frame.top & ~window_mask) | (destination + 1)
	end
	return fault
end

return { bind = bind, receive_ram = receive_ram }
