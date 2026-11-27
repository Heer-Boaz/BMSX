module<const>

local frames<const> = require('kernel/thread_frame_storage')
local layout<const> = require('kernel/gc_runtime_layout')
local retire<const> = require('kernel/thread_retire')
local roots<const> = require('kernel/gc_operand_roots')
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
	return frames.prepare_frame_space(management, interrupted, values, depth, root, source_cycles, true) == 0
end

bss call_operands: exception_argument_roots

-- A decoded call with detached operands cannot repeat the preceding lookup.
-- The fixed bank is register-only, so software publishes just its tagged
-- roots in ordinary RAM for the duration of admission, not a prepared Frame.
local land_call<const> = function(values, depth, deadline, count,
	fn, pc, closure, flags, formals, base, return_base, return_count, a, b, c)
	local interrupted_port<const>: *addr = layout.interrupted_context_address
	local interrupted<const> = *interrupted_port
	local thread<const>: *thread_storage_record = interrupted
	local variadic<const> = (thread.stack_top & frame_window_mask) + formals
	local inputs<const>: *exception_argument_roots = call_operands
	local arguments<const>: *value = call_operands + offsetof(exception_argument_roots.values)
	inputs.closure, inputs.supplied = closure, count
	arguments[0], arguments[1] = a, b
	if count == 3 then arguments[2] = c end
	local scope<const> = (call_operands - layout.ram_base) | roots.exception_argument_scope
	if frames.prepare_frame_space(layout.management_offset, interrupted, values, depth, scope, deadline, true) ~= 0 then
		return nil
	end

	local output_words<const>, output_tags<const> = frames.internal.value_planes(interrupted, base)
	local parameters<const>: *u32 = output_words
	local parameter_tags<const>: *u8 = output_tags
	local copied<const> = count < formals and count or formals
	for slot = 0, copied - 1 do
		local address<const> = &arguments[slot]
		local word<const>: *u32 = address
		local tag<const>: *u8 = address + layout.value_cell_tag_offset
		parameters[slot], parameter_tags[slot] = *word, *tag
	end
	for slot = copied, formals - 1 do parameters[slot], parameter_tags[slot] = 0, 0 end
	if variadic < base then
		local offset<const> = variadic - base
		local extras<const>: *u32 = output_words + 4 * offset
		local extra_tags<const>: *u8 = output_tags + offset
		for slot = 0, base - variadic - 1 do
			local address<const> = &arguments[formals + slot]
			local word<const>: *u32 = address
			local tag<const>: *u8 = address + layout.value_cell_tag_offset
			extras[slot], extra_tags[slot] = *word, *tag
		end
	end

	local size<const> = thread.frame_depth & control_count_mask
	local block<const>: *stopped_frame = layout.ram_base + (thread.frame_block & word_mask)
	local callee<const>: *stopped_frame = &block[size]
	callee.fn, callee.call_site, callee.head, callee.flags = fn, cop0.epc, 0, flags
	callee.pc, callee.vararg_base, callee.argument_count = pc, variadic, count
	callee.return_base, callee.return_count = return_base, return_count
	callee.top, callee.closure = formals, closure
	callee.stack_base, callee.stack_capacity = base, values - base
	thread.stack_top, thread.frame_depth = values, size + 1
	return pc
end

return { recover = recover, land_call = land_call }
