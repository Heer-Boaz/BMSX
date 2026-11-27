module<const>

local frames<const> = require('kernel/thread_frame_storage')
local vectors<const> = require('bmsx/startup')
local layout<const> = require('kernel/gc_runtime_layout')
local operand_roots<const> = require('kernel/gc_operand_roots')
local exception_report<const> = require('kernel/exception_report')
local window<const> = require('kernel/register_window')
local protected<const> = require('kernel/protected_return')
local syscall<const> = 8 << 2
local trap<const> = 13 << 2
local register_window<const> = 14 << 2
local out_of_memory<const> = 9
local string_tag<const> = 5
local nmi<const> = 1 << 16
local system_supervisor_fault<const> = 1 << 3
local system_supervisor_resumable<const> = 1 << 2
local control_count_mask<const> = (1 << 18) - 1
local frame_window_mask<const> = (1 << 20) - 1
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

local enter<const> = function(values, depth, instruction, source_cycles)
	local cause<const> = cop0.cause
	local denied_window<const> = cause == register_window
	if cause == syscall then
		local interrupted<const>: *addr = layout.interrupted_context_address
		if *interrupted ~= 0 then
			local resume_pc<const> = protected.finish_handler(*interrupted, values)
			if resume_pc then
				cop0.epc = resume_pc
				blua32.rfe()
			end
		end
	end
	if denied_window then
		local recovered<const>, resume_pc<const>, resume_context<const> = window.recover(values, depth, instruction, source_cycles)
		if recovered then
			if resume_context then
				local interrupted<const>: *addr = layout.interrupted_context_address
				*interrupted = resume_context
			end
			if resume_pc then cop0.epc = resume_pc end
			blua32.rfe()
		end
	end
	local ready<const>: *word = monitor_ready
	if *ready ~= 0 then
		local raised<const> = cause == trap or denied_window
		if raised then
			local interrupted<const>: *addr = layout.interrupted_context_address
			if denied_window then
				local thread<const>: *thread_storage_record = *interrupted
				local diagnostics<const>: *startup_root_head = layout.ram_base + layout.management_offset + layout.remark_head_offset
				local fault_ids<const>: *u32 = diagnostics.fault_ids
				thread.error_word = fault_ids[out_of_memory]
				thread.error_tag = string_tag
			else
				local error<const>: *value = *interrupted + offsetof(thread_storage_record.error_word)
				*error = values
			end
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
			entry.cause = denied_window and trap or cause
			entry.epc = cop0.epc
			entry.bad_address = cop0.bad_address
			entry.lua_fault_reason = denied_window and out_of_memory or cop0.lua_fault_reason
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
}
