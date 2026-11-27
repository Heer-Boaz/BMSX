module<const>

local frames<const> = require('kernel/thread_frame_storage')
local layout<const> = require('kernel/gc_runtime_layout')
local retire<const> = require('kernel/thread_retire')
local protected<const> = require('kernel/protected_return')
local isa<const> = require('bmsx/blua32')

local closure_kind<const> = 7
local word_mask<const> = 0x003ffffc
local record_mask<const> = 0x003ffff8
local control_count_mask<const> = (1 << 18) - 1
local frame_window_mask<const> = (1 << 20) - 1

-- Reference: f3872c7d1b192af97a83c81c9404b627658d5109 cpu.ts:3179,3269-3271,4132-4145,4353-4373;
-- cpu_calls.inl:137-143,173-181; cpu.cpp:3051,3105-3108.
-- The issuing CPU frame remains intact and is the only source of live
-- operands. Reserve backing, then let the same instruction place its Values.
local recover<const> = function(values, depth, instruction, deadline)
	local interrupted_port<const>: *addr = layout.interrupted_context_address
	local interrupted<const> = *interrupted_port
	local source_cycles = deadline
	local thread<const>: *thread_storage_record = interrupted
	local frame_depth<const> = thread.frame_depth & control_count_mask
	local address<const> = layout.ram_base + ((thread.frame_block + (frame_depth - 1) * sizeof(frame_record)) & word_mask)
	local management<const> = layout.management_offset
	local op<const> = instruction & 0xff
	local root = 0
	if op == isa.op_ret then
		-- The old RET closed cells before assisting. Its per-cell charge
		-- is now guest work; only debit the already sampled policy horizon.
		local closed<const> = retire.retire_open_cells(management + layout.control_offset,
			management + layout.arena_offset, address, 0)
		source_cycles = source_cycles > closed and source_cycles - closed or 0
	elseif op == isa.op_call then
		local frame<const>: *frame_record = address
		local slot<const> = (frame.stack_base & frame_window_mask) + (instruction >> 8)
		local payload<const>, kind<const> = frames.internal.value_planes(interrupted, slot)
		local tag<const>: *u8 = kind
		if *tag == closure_kind then
			local word<const>: *u32 = payload
			-- The CPU already admitted this Closure. Preserve the canonical
			-- absolute explicit root formerly supplied by pushFrame.
			root = layout.ram_base + (*word & record_mask)
		end
	end
	if frames.prepare_frame_space(management, interrupted, values, depth, root, source_cycles, true) == 0 then
		return true, nil, nil
	end
	local caught<const>, pc<const>, context<const> = protected.catch_window_oom(interrupted, deadline)
	return caught, pc, context
end

return { recover = recover }
