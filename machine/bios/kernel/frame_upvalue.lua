module<const>

-- Source basis: aca57683b472c8ee0ea2df3252d06f8fb380b062.
-- Diagnostic Thread and Frame window selection is separate from SETUP.
-- Both operations store through the actual capture's owner, including
-- suspended stacks; a closed cell uses the shared collector barrier.
local layout<const> = require('kernel/gc_runtime_layout')
local allocator<const> = require('kernel/dlmalloc')
local captures<const> = require('kernel/gc_capture_trace')
local barrier<const> = require('kernel/gc_barrier')

local word_mask<const> = 0x003ffffc
local byte_mask<const> = 0x003fffff
local record_mask<const> = 0x003ffff8
local object_prefix<const> = 8
local thread_kind<const>, thread_tag<const> = 4, 9
local integer_tag<const>, float_tag<const> = 3, 4
local invalid_argument<const> = 10
local control_count_mask<const> = (1 << 18) - 1
local frame_bytes<const> = 56
local frame_closure<const> = 44
local upvalue_open_bit<const> = 1

struct diagnostic_thread
	kind: u8
	before_stack_block: u8[23]
	stack_block: addr
	stack_capacity: u32
	before_frame_depth: u32[6]
	frame_depth: u32
	protected_depth: u32
	frame_block: addr
end

struct diagnostic_upvalue
	before_flags: u8[2]
	flags: u8
	tag: u8
	word: u32
	owner: addr
end

-- Integer operands admit exactly the nonnegative integral values below
-- the selected physical extent, including integral floats.
local bounded_ordinal<const> = function(argument, address, count)
	local value<const>: *value = address
	local kind<const>: *u8 = address + layout.value_cell_tag_offset
	*value = argument
	if *kind ~= integer_tag and *kind ~= float_tag then return -1 end
	if not (argument >= 0 and argument < count) then return -1 end
	if argument // 1 ~= argument then return -1 end
	return argument & -1
end

local set_frame_upvalue<const> = function(target, index, ordinal, replacement)
	local port<const>: *u32 = layout.management_address
	local fault<const>: *u32 = layout.call_fault_address
	local management<const> = *port
	local arena<const> = management + layout.arena_offset
	local address<const> = layout.ram_base + management + layout.value_cell_offset
	local value<const>: *value = address
	local word<const>: *u32 = address
	local tag<const>: *u8 = address + layout.value_cell_tag_offset
	*value = target
	if *tag ~= thread_tag then
		*fault = invalid_argument
		return
	end
	local offset<const> = *word & record_mask
	local thread<const>: *diagnostic_thread = layout.ram_base + offset
	if thread.kind ~= thread_kind or allocator.bmsx_dlmalloc_is_object(arena, offset - object_prefix) == 0 then
		*fault = invalid_argument
		return
	end
	local frame<const> = bounded_ordinal(index, address, thread.frame_depth & control_count_mask)
	if frame < 0 then
		*fault = invalid_argument
		return
	end
	local closure_word<const>: *addr = layout.ram_base + ((thread.frame_block + frame_bytes * frame + frame_closure) & word_mask)
	local closure<const> = *closure_word
	-- Hardware-only frames have no Closure and therefore no captures.
	local count<const> = closure == 0 and 0 or captures.internal.capture_count(closure)
	local capture<const> = bounded_ordinal(ordinal, address, count)
	if capture < 0 then
		*fault = invalid_argument
		return
	end
	local cell_offset<const> = captures.internal.capture_address(closure, capture) & record_mask
	local cell<const>: *diagnostic_upvalue = layout.ram_base + cell_offset
	*value = replacement
	local kind<const>, payload<const> = *tag, *word
	if (cell.flags & upvalue_open_bit) ~= 0 then
		local owner<const>: *diagnostic_thread = layout.ram_base + (cell.owner & word_mask)
		local block<const>, slot<const> = owner.stack_block & word_mask, cell.word
		local slot_word<const>: *u32 = layout.ram_base + ((block + 4 * slot) & word_mask)
		local slot_tag<const>: *u8 = layout.ram_base + ((block + 4 * owner.stack_capacity + slot) & byte_mask)
		*slot_word = payload
		*slot_tag = kind
	else
		barrier.store_closed_value(management + layout.control_offset, arena, management + layout.metadata_offset, cell_offset, kind, payload, 1)
	end
end

return { set_frame_upvalue = set_frame_upvalue, internal = { bounded_ordinal = bounded_ordinal } }
