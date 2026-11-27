module<const>

local frames<const> = require('kernel/thread_frame_storage')
local vectors<const> = require('bmsx/startup')
local layout<const> = require('kernel/gc_runtime_layout')
local operand_roots<const> = require('kernel/gc_operand_roots')
local exception_report<const> = require('kernel/exception_report')
local window<const> = require('kernel/register_window')
local protected<const> = require('kernel/protected_return')
local coroutine_transfer<const> = require('kernel/coroutine_transfer')
local syscall<const> = 8 << 2
local trap<const> = 13 << 2
local register_window<const> = 14 << 2
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
	return frames.prepare_frame_space(management, interrupted, values, depth, root, 0, true) == 0
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
local transfer_coroutine<const> = function(address, operand)
	local context<const>: *stopped_thread = address
	local depth<const> = context.frame_depth & control_count_mask
	local frame<const>: *stopped_frame = layout.ram_base + ((context.frame_block + (depth - 1) * sizeof(stopped_frame)) & ram_word_mask)
	if (frame.flags & cartridge_bank) ~= 0 then return false, nil, nil, nil end
	local fn<const> = frame.fn
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
	local denied_window<const> = cause == register_window
	local interrupted<const>: *addr = layout.interrupted_context_address
	local transfer_fault
	if cause == syscall and *interrupted ~= 0 then
		local handled<const>, pc<const>, thread<const>, reason<const> = transfer_coroutine(*interrupted, values)
		if handled then
			*interrupted = thread
			if pc then
				cop0.epc = pc
				blua32.rfe()
			end
			transfer_fault = reason
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
	local reason<const> = transfer_fault or (denied_window and out_of_memory) or cop0.lua_fault_reason
	local raised<const> = cause == trap or denied_window or transfer_fault ~= nil
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
		local deadline<const> = denied_window and source_cycles or 0
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
			entry.cause = (denied_window or transfer_fault ~= nil) and trap or cause
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
	internal = { transfer_coroutine = transfer_coroutine },
}
