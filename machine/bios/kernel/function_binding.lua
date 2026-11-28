module<const>

local layout<const> = require('kernel/gc_runtime_layout')
local records<const> = require('kernel/allocate_record')
local captured<const> = require('kernel/allocate_captured_closure')
local closure_index<const> = require('kernel/canonical_closure_index')
local _capture_layout<const> = require('kernel/closure_capture_create')
local _image_layout<const> = require('kernel/system_image_bind')
local frames<const> = require('kernel/thread_frame_storage').internal
local tags<const> = require('kernel/value_type')
local isa<const> = require('bmsx/blua32')
local management<const> = layout.management_offset
local binding_address<const> = layout.ram_base + management + layout.function_binding_offset
local control_count_mask<const> = (1 << 18) - 1
local window_mask<const> = (1 << 20) - 1
local ram_word_mask<const> = 0x003ffffc
local closure_tag<const> = 7
local latched_prototype<const> = 8
local static_function<const> = isa.function_static_flag
local code_flags<const> = static_function | isa.function_code_flag
local out_of_memory<const> = 9
local invalid_argument<const> = 10
local cartridge_bank<const> = 1 << 3
local second_socket_shift<const> = 4
local ordinary_ram_start<const> = 0x08040000
local system_rom_end<const> = 0x01000000
local cart_rom_start<const> = 0x10000000
local cart_rom_end<const> = 0x30000000
local boot_header_bytes<const> = 60
local boot_image_offset<const> = 32
local boot_image_byte_count<const> = 36
local image_magic<const> = 0x32334c42
local function_alignment_mask<const> = 15

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

-- Sample the Function once before reserving storage. RAM builds retain the
-- sampled entry; an admitted ROM prototype keeps its ordinary image binding.
local receive<const> = function(owner, destination, count, deadline)
	if count ~= 1 then return invalid_argument end
	local thread<const>: *stopped_thread = owner
	local depth<const> = thread.frame_depth & control_count_mask
	local frame<const>: *stopped_frame = layout.ram_base + ((thread.frame_block + (depth - 1) * sizeof(stopped_frame)) & ram_word_mask)
	local words<const>, kinds<const> = frames.value_planes(owner, (frame.stack_base & window_mask) + destination + 1)
	local address<const>: *u32 = words
	local kind<const>: *u8 = kinds
	local prototype<const> = *address
	if *kind ~= tags.integer_tag or (prototype & function_alignment_mask) ~= 0 then
		return invalid_argument
	end
	local record_bytes<const> = sizeof(launch_function_record)
	local domain = (frame.flags & cartridge_bank) == 0 and -1 or ((frame.flags >> second_socket_shift) & 1)
	local rom, rom_base, ram_end, image = 0, 0, 0, 0
	if prototype >= 0 and prototype < system_rom_end then
		domain, rom = -1, 1
	elseif prototype >= cart_rom_start and prototype < cart_rom_end then
		if domain < 0 then
			local select<const>: *word = 0x08010420
			domain = *select & 1
		end
		rom, rom_base = 1, cart_rom_start
	else
		ram_end = cop0.ram_end
		if prototype < ordinary_ram_start or prototype > ram_end - record_bytes then
			return invalid_argument
		end
	end
	if rom ~= 0 then
		-- A raw syscall can name ROM data as well as Functions. Require an
		-- entire directory entry from the image on the issuing bus.
		local rom_bytes<const>: *word = 0x080101f4 + 4 * (domain + 1)
		local extent<const> = *rom_bytes
		if extent < boot_header_bytes or prototype - rom_base > extent - record_bytes then return invalid_argument end
		local offset<const> = blua32.context_word(rom_base + boot_image_offset)
		local bytes<const> = blua32.context_word(rom_base + boot_image_byte_count)
		local header_bytes<const> = sizeof(immutable_image_operands)
		if offset < boot_header_bytes or (offset & 3) ~= 0
			or bytes < header_bytes or offset > extent - bytes then
			return invalid_argument
		end
		image = rom_base + offset
		if blua32.context_word(image + offsetof(immutable_image_operands.magic)) ~= image_magic then return invalid_argument end
		local functions<const> = blua32.context_word(image + offsetof(immutable_image_operands.functions))
		local count<const> = blua32.context_word(image + offsetof(immutable_image_operands.function_count))
		local relative<const>, entry<const> = functions - image, prototype - functions
		if (functions & function_alignment_mask) ~= 0 or relative < header_bytes
			or count <= 0 or count > (bytes - relative) // record_bytes
			or entry < 0 or (entry & (record_bytes - 1)) ~= 0 or entry >= count * record_bytes then
			return invalid_argument
		end
	end
	local code<const> = blua32.context_word(prototype + offsetof(launch_function_record.code))
	if rom == 0 and (code < ordinary_ram_start or code >= ram_end) then return invalid_argument end
	local formals<const> = blua32.context_word(prototype + offsetof(launch_function_record.formals))
	local stack<const> = blua32.context_word(prototype + offsetof(launch_function_record.maximum))
	local flags<const> = blua32.context_word(prototype + offsetof(launch_function_record.flags))
	local descriptors<const> = blua32.context_word(prototype + offsetof(launch_function_record.captures))
	local captures<const> = blua32.context_word(prototype + offsetof(launch_function_record.capture_count))
	if rom ~= 0 and captures == 0 and (flags & code_flags) == code_flags
		and (blua32.context_word(image + offsetof(immutable_image_operands.flags)) & isa.image_mapped_code_flag) == 0 then
		local result_word<const>: *u32 = words - 4
		local result_kind<const>: *u8 = kinds - 1
		*result_word, *result_kind = prototype | (domain == 1 and 0x80000000 or 0), tags.code_tag
		frame.top = (frame.top & ~window_mask) | (destination + 1)
		return nil
	end
	local fault<const> = bind(owner, frame, destination, prototype, domain, code, formals, stack, flags, descriptors, captures, rom, deadline)
	if fault == nil then
		frame.top = (frame.top & ~window_mask) | (destination + 1)
	end
	return fault
end

return { bind = bind, receive = receive }
