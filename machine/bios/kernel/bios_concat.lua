module<const>

-- The actual caller owns the operands at CALL's A+2. Only the count
-- crosses into this activation; neither a Thread nor a private pointer
-- can be supplied by a cartridge.
local layout<const> = require('kernel/gc_runtime_layout')
local strings<const> = require('kernel/allocate_string_slice')
local media_binding<const> = require('kernel/image_string_bindings')

local invalid_argument<const> = 10
local out_of_memory<const> = 9
local integer_tag<const> = 3
local string_tag<const> = 5
local word_mask<const> = 0x003ffffc
local frame_window_mask<const> = 0x000fffff
local frame_count_mask<const> = 0x0003ffff
local fixed_frame_offset<const> = 0x880

local intern_concat<const> = function(count)
	local management_port<const>: *u32 = layout.management_address
	local cycles_port<const>: *u32 = layout.call_cycles_address
	local fault_port<const>: *u32 = layout.call_fault_address
	local management<const> = *management_port
	local state<const> = layout.ram_base + management
	local cell_address<const> = state + layout.value_cell_offset
	local cell<const>: *value = cell_address
	local payload<const>: *u32 = cell_address
	local tag<const>: *u8 = cell_address + layout.value_cell_tag_offset
	*cell = count
	if *tag ~= integer_tag or count < 0 then *fault_port = invalid_argument; return nil end

	-- Current activation's retained architectural Thread. This existing
	-- projection also supplies the inputs needed if admission collects.
	local project<const>: *word = state + layout.effect_offset
	*project = layout.publish_roots
	local roots<const>: *root_descriptors = state + layout.root_banks_offset
	local owner<const> = roots.active
	local thread<const>: *thread_storage_record = owner
	local depth<const> = thread.frame_depth & frame_count_mask
	local resident<const>: *frame_record = state + fixed_frame_offset
	local first<const> = (resident.return_base & frame_window_mask) + 2
	local selected<const>: *frame_record = layout.ram_base + ((thread.frame_block + (depth - 1) * sizeof(frame_record)) & word_mask)
	local top<const>, capacity<const> = selected.top & frame_window_mask, selected.stack_capacity & frame_window_mask
	local end_slot<const> = top < capacity and top or capacity
	if first > end_slot or count > end_slot - first then
		*fault_port = invalid_argument
		return nil
	end
	local absolute_first<const> = (selected.stack_base & frame_window_mask) + first
	local media<const>: *bound_media_extents = state + media_binding.media_extents_offset
	local id<const>, fault<const> = strings.intern_concat(management, owner, absolute_first, count, *cycles_port,
		media.system, media.cart0, media.cart1)
	if fault ~= 0 then
		*fault_port = invalid_argument
		return nil
	end
	if id == 0 then
		*fault_port = out_of_memory
		return nil
	end
	*payload = id
	*tag = string_tag
	return *cell
end

return { intern_concat = intern_concat }
