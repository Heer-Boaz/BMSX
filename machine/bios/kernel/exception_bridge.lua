module<const>

local frames<const> = require('kernel/thread_frame_storage')
local vectors<const> = require('bmsx/startup')
local layout<const> = require('kernel/gc_runtime_layout')
local operand_roots<const> = require('kernel/gc_operand_roots')
local exception_report<const> = require('kernel/exception_report')
local window<const> = require('kernel/register_window')
local protected<const> = require('kernel/protected_return')
local coroutine_transfer<const> = require('kernel/coroutine_transfer')
local retire<const> = require('kernel/thread_retire')
local barrier<const> = require('kernel/gc_barrier')
local globals<const> = require('kernel/global_bank')
local table_growth<const> = require('kernel/table_grow')
local binding<const> = require('kernel/function_binding')
local strings<const> = require('kernel/string_control_call')
local firmware_ids<const> = require('kernel/heap_control_ids')
local table_ids<const> = require('kernel/bios_table_ids')
local thread_ids<const> = require('kernel/coroutine_control_ids')
local value_tags<const> = require('kernel/value_type')
local table_calls<const> = require('kernel/bios_table_call')
local thread_calls<const> = require('kernel/coroutine_control')
local heap_control<const> = require('kernel/heap_control_call')
local syscall<const> = 8 << 2
local trap<const> = 13 << 2
local register_window<const> = 14 << 2
local reference_store<const> = 15 << 2
local storage_window<const> = 16 << 2
local function_binding<const> = 17 << 2
local explicit_error<const> = 8
local out_of_memory<const> = 9
local string_tag<const> = 5
local nmi<const> = 1 << 16
local system_supervisor_fault<const> = 1 << 3
local system_supervisor_resumable<const> = 1 << 2
local control_count_mask<const> = (1 << 18) - 1
local frame_window_mask<const> = (1 << 20) - 1
local ram_word_mask<const> = 0x003ffffc
local cartridge_bank<const> = 1 << 3
local exception_frame<const> = 1 << 1
local invalid_argument<const> = 10
bss monitor_ready: word

struct monitor_entry_state
	status: u32
	cause: u32
	epc: addr
	bad_address: addr
	lua_fault_reason: u32
	irq_mask: u32
	cart_select: u32
	owns_supervisor_context: u32
end

bss monitor_entry: monitor_entry_state

local frame_width<const> = function(address)
	local entry<const>: *launch_function_record = address
	local width = entry.maximum
	if width < entry.formals then width = entry.formals end
	if width == 0 then width = 1 end
	return width
end

-- The fixed vector has no Closure. Root its tagged trap argument if this
-- transfer needs to collect in order to prepare the interrupted stack.
local prepare<const> = function(width, argument)
	local interrupted_port<const>: *addr = layout.interrupted_context_address
	local interrupted<const> = *interrupted_port
	local thread<const>: *thread_storage_record = interrupted
	local values<const> = (thread.stack_top & frame_window_mask) + width
	local depth<const> = (thread.frame_depth & control_count_mask) + 1
	if values <= thread.stack_capacity and depth <= (thread.frame_capacity & control_count_mask) then return true end
	local management<const> = layout.management_offset
	local root = 0
	if argument then
		root = operand_roots.single_value_scope(management, thread.error_tag & 0xff, thread.error_word)
	end
	-- There is no issuing allocation allowance in the fixed vector. If
	-- backing remains unavailable the direct target cannot be entered.
	return frames.prepare_frame_space(management, interrupted, values, depth, root, 0) == 0
end

local take_trap_value<const> = function()
	local entry<const>: *monitor_entry_state = monitor_entry
	if entry.cause ~= trap then return nil end
	local error<const>: *value = cop0.current + offsetof(thread_storage_record.error_word)
	local raised<const> = *error
	*error = nil
	return raised
end

-- These are System program entry points, not CPU service ordinals.
local transfer_context<const> = function(address, operand)
	local context<const>: *stopped_thread = address
	local depth<const> = context.frame_depth & control_count_mask
	local frame<const>: *stopped_frame = layout.ram_base + ((context.frame_block + (depth - 1) * sizeof(stopped_frame)) & ram_word_mask)
	if (frame.flags & cartridge_bank) ~= 0 then return false, nil, nil, nil end
	local fn<const> = frame.fn
	if fn == vectors.frame_unwind then
		if blua32.tag(operand) ~= value_tags.integer_tag or operand < 1 or operand >= depth then
			return true, nil, address, invalid_argument
		end
		local block<const>: *stopped_frame = layout.ram_base + (context.frame_block & ram_word_mask)
		for index = operand - 1, depth - 1 do
			if (block[index].flags & exception_frame) ~= 0 then return true, nil, address, invalid_argument end
		end
		local pc<const> = block[operand - 1].pc
		local management<const> = layout.management_offset
		retire.retire_thread_frames(management + layout.control_offset, management + layout.arena_offset, address, operand)
		return true, pc, address, nil
	end
	if fn == vectors.coroutine_resume then
		local cell_address<const> = layout.ram_base + layout.management_offset + layout.value_cell_offset
		local value_cell<const>: *value = cell_address
		local word<const>: *u32 = cell_address
		*value_cell = operand
		local pc<const>, thread<const>, reason<const> = coroutine_transfer.resume(address, frame, *word)
		return true, pc, thread, reason
	end
	if fn == vectors.coroutine_yield then
		local pc<const>, thread<const>, reason<const> = coroutine_transfer.yield(address, frame)
		return true, pc, thread, reason
	end
	if fn == vectors.coroutine_entry then
		local pc<const>, thread<const>, reason<const> = coroutine_transfer.finish(address, frame, operand)
		return true, pc, thread, reason
	end
	return false, nil, nil, nil
end

-- The direct entry reserves the full architectural call-overflow argument
-- prefix. Ordinary traps still supply their original shorter argument list.
local enter<const> = function(values, depth, instruction, source_cycles, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14)
	local cause<const> = cop0.cause
	if cause == reference_store then
		if blua32.argument_count() == 2 then globals.store_reference(cop0.bad_address, depth, values)
		else barrier.store_closed_upvalue(cop0.bad_address, values) end
		blua32.rfe()
	end
	local denied_window<const> = cause == register_window
	local denied_storage<const> = cause == storage_window
	local interrupted<const>: *addr = layout.interrupted_context_address
	local transfer_fault
	if cause == function_binding then
		local pc<const>, reason<const> = binding.bind(*interrupted, values, depth, instruction, source_cycles, r4, r5, r6, r7, r8, r9, r10)
		if pc then
			cop0.epc = pc
			blua32.rfe()
		end
		transfer_fault = reason
	end
	if denied_storage and table_growth.store_resolved(values, depth, instruction, source_cycles, r4, r5) then
		local context<const>: *stopped_thread = *interrupted
		local depth<const> = context.frame_depth & control_count_mask
		local frame<const>: *stopped_frame = layout.ram_base + ((context.frame_block + (depth - 1) * sizeof(stopped_frame)) & ram_word_mask)
		cop0.epc = frame.pc
		blua32.rfe()
	end
	if cause == syscall and *interrupted ~= 0 then
		local handled, fault = false, nil
		if blua32.tag(values) == value_tags.integer_tag then
			if (values == firmware_ids.create_table and depth ~= nil)
				or (values >= firmware_ids.collect_full and values <= firmware_ids.reserve_entry) then
				handled = true
				fault = heap_control.receive(*interrupted, values, depth, instruction)
			elseif (values == firmware_ids.string_concat and depth ~= nil) or values == firmware_ids.string_from_bytes
				or (values >= firmware_ids.string_slice and values <= firmware_ids.string_index) then
				handled = true
				fault = strings.receive(*interrupted, values, depth, instruction)
			elseif values >= table_ids.copy and values <= table_ids.set_global then
				handled = true
				fault = table_calls.receive(*interrupted, values, depth, instruction)
			elseif values >= thread_ids.create and values <= thread_ids.set_frame_upvalue then
				handled = true
				fault = thread_calls.receive(*interrupted, values, depth, instruction)
			end
		end
		if handled then
			if fault == nil then blua32.rfe() end
			transfer_fault = fault
		else
			local handled<const>, pc<const>, thread<const>, reason<const> = transfer_context(*interrupted, values)
			if handled then
				*interrupted = thread
				if pc then
					cop0.epc = pc
					blua32.rfe()
				end
				transfer_fault = reason
			end
		end
	end
	if denied_window then
		if instruction == 0 then
			local count<const> = blua32.argument_count() - 12
			local pc<const> = window.land_call(values, depth, source_cycles, count,
				r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14)
			if pc then
				cop0.epc = pc
				blua32.rfe()
			end
		elseif instruction == -1 then
			local available<const> = blua32.argument_count() - 6
			local pc<const> = window.land_results(values, depth, source_cycles, r4, r5, available,
				r6, r7, r8, r9, r10, r11, r12, r13, r14)
			if pc then
				cop0.epc = pc
				blua32.rfe()
			end
		elseif window.recover(values, depth, instruction, source_cycles) then blua32.rfe() end
	end
	local denied_backing<const> = denied_window or denied_storage
	local reason<const> = transfer_fault or (denied_backing and out_of_memory) or cop0.lua_fault_reason
	local raised<const> = cause == trap or denied_backing or transfer_fault ~= nil
	local payload, tag = 0, 0
	if raised then
		if reason == explicit_error then
			-- The architectural argument is a Value, including a supplied Nil.
			local address<const> = layout.ram_base + layout.management_offset + layout.value_cell_offset
			local cell<const>: *value = address
			local word<const>: *u32 = address
			local kind<const>: *u8 = address + layout.value_cell_tag_offset
			*cell = values
			payload, tag = *word, *kind
		else
			-- Numeric traps supply only their reason. The BIOS owns these
			-- boot-interned diagnostics and their root lifetime.
			local diagnostics<const>: *startup_root_head = layout.ram_base + layout.management_offset + layout.remark_head_offset
			local fault_ids<const>: *u32 = diagnostics.fault_ids
			payload, tag = fault_ids[reason], string_tag
		end
		local deadline<const> = denied_window and source_cycles or (denied_storage and r4 or (cause == function_binding and r10 or 0))
		local caught<const>, resume_pc<const>, resume_context<const> = protected.catch_fault(*interrupted, payload, tag, deadline)
		if caught then
			if resume_context then *interrupted = resume_context end
			if resume_pc then cop0.epc = resume_pc end
			blua32.rfe()
		end
	end
	local ready<const>: *word = monitor_ready
	if *ready ~= 0 then
		if raised then
			local thread<const>: *thread_storage_record = *interrupted
			local error_tag<const>: *u8 = *interrupted + offsetof(thread_storage_record.error_tag)
			thread.error_word = payload
			*error_tag = tag
		end
		if prepare(frame_width(vectors.managed_exception), raised) then
			-- A managed CALL can exhaust its window before the monitor reads
			-- CP0. Preserve the outer event while still on the fixed bank.
			local irq_mask<const>: *word = 0x08000008
			local system_control<const>: *word = 0x0801034c
			local system_status<const>: *word = 0x08010350
			local cart_select<const>: *word = 0x08010420
			local entry<const>: *monitor_entry_state = monitor_entry
			entry.status = cop0.status
			-- A physical Window fault is still visible in SYSTEM. The stock
			-- monitor presents the language error after recovery was denied.
			entry.cause = (denied_backing or transfer_fault ~= nil) and trap or cause
			entry.epc = cop0.epc
			entry.bad_address = cop0.bad_address
			entry.lua_fault_reason = reason
			entry.irq_mask = *irq_mask
			entry.cart_select = *cart_select
			entry.owns_supervisor_context = (*system_status & system_supervisor_resumable) == 0 and 1 or 0
			-- Let SYSTEM sample the same original cause, including its
			-- execution domain. Publishing waits for the monitor display.
			if (cause & nmi) == 0 then *system_control = system_supervisor_fault end
			cop0.exception_target = vectors.managed_exception
		end
	end
	if exception_report.report(cause) then blua32.rfe() end
	while true do end
end

return {
	enter = enter, prepare = prepare, frame_width = frame_width,
	monitor_ready = monitor_ready, monitor_entry = monitor_entry, take_trap_value = take_trap_value,
	internal = { transfer_context = transfer_context },
}
