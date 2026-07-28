local terminal<const> = require('bios/terminal')
local layout<const> = require('bios/terminal_layout')
local monitor_editor<const> = require('bios/monitor_editor')
local monitor_commands<const> = require('bios/monitor_commands')
local vblank<const> = require('bios/vblank')
local dma_transfer<const> = require('bios/dma_transfer')
local gx_gpu<const> = require('system/gx_gpu')
local romdir<const> = require('system/romdir')

local byte<const> = __bmsx_string_byte
local monitor<const> = {}

local irq_mask<const>: *word = 0x08000008
local input_control<const>: *word = 0x08000064
local input_keys<const>: *word[8] = 0x0800006c
local system_print_data<const>: *word = 0x0801022c
local system_print_count<const>: *word = 0x08010230
local system_control<const>: *word = 0x08010348
local system_status<const>: *word = 0x0801034c

local irq_vblank<const> = 0x0004
local irq_dma_done<const> = 0x0001
local irq_gpu<const> = 0x0040
local input_arm<const> = 0x00000001
local system_supervisor_enter<const> = 0x00000002
local system_supervisor_leave<const> = 0x00000004
local system_supervisor_fault<const> = 0x00000008
local system_supervisor_exit_requested<const> = 0x00000002
local system_supervisor_resumable<const> = 0x00000004
local cause_nmi<const> = 0x00010000

local palette_text<const> = terminal.palette_text
local palette_prompt<const> = terminal.palette_accent

local ascii_backspace<const> = 8
local ascii_newline<const> = 10
local ascii_space<const> = 32
local ascii_digit_0<const> = 48
local ascii_upper_a<const> = 65

local monitor_mode_edit<const> = 0
local monitor_mode_pager<const> = 1
local monitor_mode_completion<const> = 2
local key_result_none<const> = 0
local key_result_repeat<const> = 1
local key_result_continue<const> = 2

local hid_first_key<const> = 4
local hid_last_key<const> = 115
local hid_q<const> = 20
local hid_enter<const> = 40
local hid_escape<const> = 41
local hid_backspace<const> = 42
local hid_tab<const> = 43
local hid_space<const> = 44
local hid_home<const> = 74
local hid_page_up<const> = 75
local hid_delete<const> = 76
local hid_end<const> = 77
local hid_page_down<const> = 78
local hid_right<const> = 79
local hid_left<const> = 80
local hid_down<const> = 81
local hid_up<const> = 82
local hid_numpad_enter<const> = 88
local hid_left_control<const> = 224
local hid_left_shift<const> = 225
local hid_right_control<const> = 228
local hid_right_shift<const> = 229

local repeat_delay_frames<const> = 18
local repeat_interval_frames<const> = 4

bss monitor_current_keys: word[8]
bss monitor_previous_keys: word[8]
bss monitor_output_row: word[layout.columns]
bss monitor_frame: word
bss monitor_repeat_usage: word
bss monitor_repeat_frame: word
bss monitor_mode: word
bss monitor_completion_count: word
bss monitor_completion_selection: word

local initialize_input<const> = function()
	*monitor_frame = 0
	*monitor_repeat_usage = 0
	*monitor_repeat_frame = 0
	*monitor_mode = monitor_mode_edit
	local current_keys<const>: *word = monitor_current_keys
	local previous_keys<const>: *word = monitor_previous_keys
	for index = 0, 7 do
		local keys<const> = input_keys[index]
		current_keys[index] = keys
		previous_keys[index] = keys
	end
end

local map_hid_key<const> = function(usage, shift)
	if usage >= 4 and usage <= 29 then
		return ascii_upper_a + usage - 4
	end
	if usage >= 30 and usage <= 38 then
		if shift then
			return byte('!@#$%^&*(', usage - 29)
		end
		return usage + 19
	end
	if usage == 39 then return shift and 41 or ascii_digit_0 end
	if usage == hid_enter or usage == hid_numpad_enter then return ascii_newline end
	if usage == hid_backspace then return ascii_backspace end
	if usage == hid_space then return ascii_space end
	if usage == 45 then return shift and 95 or 45 end
	if usage == 46 then return shift and 43 or 61 end
	if usage == 47 then return shift and 123 or 91 end
	if usage == 48 then return shift and 125 or 93 end
	if usage == 49 then return shift and 124 or 92 end
	if usage == 51 then return shift and 58 or 59 end
	if usage == 52 then return shift and 34 or 39 end
	if usage == 53 then return shift and 126 or 96 end
	if usage == 54 then return shift and 60 or 44 end
	if usage == 55 then return shift and 62 or 46 end
	if usage == 56 then return shift and 63 or 47 end
	return 0
end

local write_prompt<const> = function()
	terminal.write('> ', palette_prompt)
	monitor_editor.begin()
end

local finish_output<const> = function()
	*monitor_mode = monitor_mode_edit
	terminal.clear_status()
	write_prompt()
end

local pump_output<const> = function(line_limit)
	terminal.clear_status()
	terminal.follow_output()
	for line = 1, line_limit do
		local result<const> = monitor_commands.next_row(monitor_output_row)
		terminal.append_row(monitor_output_row)
		if result == monitor_commands.row_done then
			finish_output()
			return
		end
	end
	*monitor_mode = monitor_mode_pager
	terminal.show_status('-- MORE --  ENTER LINE  SPACE PAGE  UP/DOWN SCROLL  Q QUIT', palette_prompt)
end

local handle_command_action<const> = function(action)
	if action == monitor_commands.action_clear then
		terminal.clear()
		write_prompt()
	elseif action == monitor_commands.action_output then
		pump_output(terminal.page_rows)
	elseif action == monitor_commands.action_continue then
		return true
	else
		write_prompt()
	end
	return false
end

local submit_input<const> = function()
	local line<const>, length<const> = monitor_editor.submit()
	terminal.write_code(ascii_newline, palette_text)
	return handle_command_action(monitor_commands.start(line, length))
end

local move_completion<const> = function(delta)
	*monitor_completion_selection = (*monitor_completion_selection + delta + *monitor_completion_count) % *monitor_completion_count
	monitor_editor.show_candidates(*monitor_completion_selection, *monitor_completion_count)
end

local handle_pager_key<const> = function(usage)
	if usage == hid_q or usage == hid_escape then
		monitor_commands.cancel()
		terminal.follow_output()
		finish_output()
		return false
	end
	if usage == hid_up then
		terminal.scroll_view(1)
		return true
	end
	if usage == hid_page_up then
		terminal.scroll_view(terminal.page_rows)
		return true
	end
	if usage == hid_home then
		terminal.scroll_view(0x7fffffff)
		return false
	end
	if usage == hid_end then
		terminal.follow_output()
		return false
	end
	if usage == hid_down then
		if not terminal.scroll_view(-1) then
			pump_output(1)
		end
		return true
	end
	if usage == hid_enter or usage == hid_numpad_enter then
		if not terminal.scroll_view(-1) then
			pump_output(1)
		end
		return false
	end
	if usage == hid_space or usage == hid_page_down then
		if not terminal.scroll_view(-terminal.page_rows) then
			pump_output(terminal.page_rows)
		end
		return true
	end
	return false
end

local process_hid_key<const> = function(usage, shift, control)
	if *monitor_mode == monitor_mode_pager then
		return handle_pager_key(usage) and key_result_repeat or key_result_none
	end
	if *monitor_mode == monitor_mode_completion then
		if usage == hid_tab or usage == hid_right or usage == hid_down then
			move_completion(1)
			return usage ~= hid_tab and key_result_repeat or key_result_none
		end
		if usage == hid_left or usage == hid_up then
			move_completion(-1)
			return key_result_repeat
		end
		if usage == hid_enter or usage == hid_numpad_enter then
			local selection<const> = *monitor_completion_selection
			*monitor_mode = monitor_mode_edit
			terminal.clear_status()
			monitor_editor.accept_candidate(selection)
			return key_result_none
		end
		if usage == hid_escape then
			*monitor_mode = monitor_mode_edit
			terminal.clear_status()
			return key_result_none
		end
		*monitor_mode = monitor_mode_edit
		terminal.clear_status()
	end
	if usage == hid_enter or usage == hid_numpad_enter then
		return submit_input() and key_result_continue or key_result_none
	end
	if usage == hid_backspace then
		if control then
			monitor_editor.backspace_word()
		else
			monitor_editor.backspace()
		end
		return key_result_repeat
	end
	if usage == hid_tab then
		local match_count<const> = monitor_editor.complete()
		if match_count > 1 then
			*monitor_mode = monitor_mode_completion
			*monitor_completion_count = match_count
			*monitor_completion_selection = 0
			monitor_editor.show_candidates(0, match_count)
		end
		return key_result_none
	end
	if usage == hid_escape then
		monitor_editor.clear()
		return key_result_none
	end
	if usage == hid_home then
		monitor_editor.home()
		return key_result_none
	end
	if usage == hid_end then
		monitor_editor.move_end()
		return key_result_none
	end
	if usage == hid_delete then
		if control then
			monitor_editor.delete_word()
		else
			monitor_editor.delete()
		end
		return key_result_repeat
	end
	if usage == hid_left then
		if control then
			monitor_editor.word_left()
		else
			monitor_editor.left()
		end
		return key_result_repeat
	end
	if usage == hid_right then
		if control then
			monitor_editor.word_right()
		else
			monitor_editor.right()
		end
		return key_result_repeat
	end
	if usage == hid_up then
		monitor_editor.previous()
		return key_result_repeat
	end
	if usage == hid_down then
		monitor_editor.next()
		return key_result_repeat
	end
	if usage == hid_page_up then
		terminal.scroll_view(terminal.page_rows)
		return key_result_repeat
	end
	if usage == hid_page_down then
		terminal.scroll_view(-terminal.page_rows)
		return key_result_repeat
	end
	local code<const> = map_hid_key(usage, shift)
	if code >= ascii_space then
		monitor_editor.insert(code)
		return key_result_repeat
	end
	return key_result_none
end

local hid_usage_high<const> = function(word, usage)
	return ((word >> (usage & 31)) & 1) ~= 0
end

local scan_keyboard<const> = function()
	local current<const>: *word = monitor_current_keys
	local previous<const>: *word = monitor_previous_keys
	local continue_requested = false
	for index = 0, 7 do
		current[index] = input_keys[index]
	end
	local shift<const> = hid_usage_high(current[hid_left_shift >> 5], hid_left_shift) or hid_usage_high(current[hid_right_shift >> 5], hid_right_shift)
	local control<const> = hid_usage_high(current[hid_left_control >> 5], hid_left_control) or hid_usage_high(current[hid_right_control >> 5], hid_right_control)
	local pressed_usage = 0
	for usage = hid_first_key, hid_last_key do
		if hid_usage_high(current[usage >> 5], usage) and not hid_usage_high(previous[usage >> 5], usage) then
			local result<const> = process_hid_key(usage, shift, control)
			if result == key_result_repeat then
				pressed_usage = usage
			elseif result == key_result_continue then
				continue_requested = true
			end
		end
	end
	if pressed_usage ~= 0 then
		*monitor_repeat_usage = pressed_usage
		*monitor_repeat_frame = *monitor_frame + repeat_delay_frames
	elseif *monitor_repeat_usage ~= 0 then
		local repeat_usage<const> = *monitor_repeat_usage
		if not hid_usage_high(current[repeat_usage >> 5], repeat_usage) then
			*monitor_repeat_usage = 0
		elseif *monitor_frame >= *monitor_repeat_frame then
			if process_hid_key(repeat_usage, shift, control) == key_result_continue then
				continue_requested = true
			end
			*monitor_repeat_frame = *monitor_repeat_frame + repeat_interval_frames
		end
	end
	for index = 0, 7 do
		previous[index] = current[index]
	end
	*monitor_frame = *monitor_frame + 1
	if *monitor_mode == monitor_mode_edit then
		if (*monitor_frame & 31) < 16 then
			terminal.show_cursor()
		else
			terminal.hide_cursor()
		end
	end
	return continue_requested
end

local leave_monitor<const> = function(saved_status, saved_epc, owns_supervisor_context)
	cop0.epc = saved_epc
	cop0.status = saved_status
	if owns_supervisor_context then
		*system_control = system_supervisor_leave
	end
end

function monitor.enter()
	-- Nested VBlank IRQ entry overwrites CP0 latches, so preserve the interrupted
	-- context before the monitor enables maskable supervisor interrupts.
	local saved_status<const> = cop0.status
	local saved_cause<const> = cop0.cause
	local saved_epc<const> = cop0.epc
	local saved_bad_address<const> = cop0.bad_address
	local saved_lua_fault_reason<const> = cop0.lua_fault_reason
	local saved_irq_mask<const> = *irq_mask
	local owns_supervisor_context<const> = (*system_status & system_supervisor_resumable) == 0

	-- Firmware owns exception classification. NMI completes an already quiesced
	-- supervisor request; a synchronous fault starts the same retained-context
	-- fence and hardware holds this handler until that bank is ready.
	if (saved_cause & cause_nmi) ~= 0 then
		*system_control = system_supervisor_enter
	else
		*system_control = system_supervisor_fault
	end
	vblank.clear()
	*irq_mask = irq_dma_done | irq_vblank | irq_gpu
	cop0.status = saved_status | 1
	-- Seed monitor edge state from one monitor-owned ICU sample. Keys held while
	-- the exception was raised must be released before they become editor input.
	*input_control = input_arm
	vblank.wait()

	initialize_input()
	monitor_editor.open()
	monitor_commands.open(
		saved_status,
		saved_cause,
		saved_epc,
		saved_bad_address,
		saved_lua_fault_reason,
		saved_irq_mask)
	gx_gpu.prepare_supervisor_256x192(layout.vram_origin) -- HUH?! Why hardcoded to 256x192? Should be layout.columns x layout.rows, but that is 80x25. Maybe this is a temporary hack for the monitor to work with the GPU in a specific mode.
	local system_texture<const> = romdir.resource('gx_system_texture')
	dma_transfer.copy_to_gp0(system_texture.addr, system_texture.len >> 2)
	terminal.open()
	terminal.write('BMSX BIOS MONITOR\n', palette_prompt)
	while *system_print_count ~= 0 do
		terminal.write_code(*system_print_data, palette_text)
	end
	monitor_commands.start_fault()
	pump_output(terminal.page_rows)
	terminal.flush()
	gx_gpu.enable_display()
	vblank.wait()

	while true do
		*input_control = input_arm
		vblank.wait()
		if (*system_status & system_supervisor_exit_requested) ~= 0 then
			leave_monitor(saved_status, saved_epc, owns_supervisor_context)
			return
		end
		local continue_requested<const> = scan_keyboard()
		terminal.flush()
		if continue_requested then
			leave_monitor(saved_status, saved_epc, owns_supervisor_context)
			return
		end
	end
end

return monitor
