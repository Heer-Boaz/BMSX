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

local irq_ack<const>: *word = 0x0800000c
local irq_mask<const>: *word = 0x08000010
local input_control<const>: *word = 0x0800006c
local input_keys<const>: *word[8] = 0x08000074

local irq_vblank<const> = 0x0004
local irq_dma_done<const> = 0x0001
local irq_gpu<const> = 0x0040
local input_arm<const> = 0x00000001

local palette_text<const> = terminal.palette_text
local palette_prompt<const> = terminal.palette_accent

local ascii_backspace<const> = 8
local ascii_newline<const> = 10
local ascii_space<const> = 32
local ascii_digit_0<const> = 48
local ascii_upper_a<const> = 65
local ascii_lower_a<const> = 97

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
bss monitor_pager_active: word
bss monitor_completion_active: word
bss monitor_completion_count: word
bss monitor_completion_selection: word
bss monitor_saved_status: word
bss monitor_saved_cause: word
bss monitor_saved_epc: word
bss monitor_saved_bad_address: word
bss monitor_saved_irq_mask: word

local initialize_input<const> = function()
	*monitor_frame = 0
	*monitor_repeat_usage = 0
	*monitor_repeat_frame = 0
	*monitor_pager_active = 0
	*monitor_completion_active = 0
	local current_keys<const>: *word = monitor_current_keys
	local previous_keys<const>: *word = monitor_previous_keys
	for index = 0, 7 do
		current_keys[index] = 0
		previous_keys[index] = 0
	end
end

local map_hid_key<const> = function(usage, shift)
	if usage >= 4 and usage <= 29 then
		return (shift and ascii_upper_a or ascii_lower_a) + usage - 4
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
	*monitor_pager_active = 0
	terminal.clear_status()
	write_prompt()
end

local pump_output<const> = function(line_limit)
	*monitor_pager_active = 0
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
	*monitor_pager_active = 1
	terminal.show_status('-- MORE --  ENTER LINE  SPACE PAGE  UP/DOWN SCROLL  Q QUIT', palette_prompt)
end

local handle_command_action<const> = function(action)
	if action == monitor_commands.action_clear then
		terminal.clear()
		write_prompt()
	elseif action == monitor_commands.action_output then
		pump_output(terminal.page_rows)
	else
		write_prompt()
	end
end

local submit_input<const> = function()
	local line<const>, length<const> = monitor_editor.submit()
	terminal.write_code(ascii_newline, palette_text)
	handle_command_action(monitor_commands.start(line, length))
end

local close_completion<const> = function()
	*monitor_completion_active = 0
	terminal.clear_status()
end

local move_completion<const> = function(delta)
	*monitor_completion_selection = (*monitor_completion_selection + delta + *monitor_completion_count) % *monitor_completion_count
	monitor_editor.show_candidates(*monitor_completion_selection)
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
	if *monitor_pager_active ~= 0 then
		return handle_pager_key(usage)
	end
	if *monitor_completion_active ~= 0 then
		if usage == hid_tab or usage == hid_right or usage == hid_down then
			move_completion(1)
			return usage ~= hid_tab
		end
		if usage == hid_left or usage == hid_up then
			move_completion(-1)
			return true
		end
		if usage == hid_enter or usage == hid_numpad_enter then
			local selection<const> = *monitor_completion_selection
			close_completion()
			monitor_editor.accept_candidate(selection)
			return false
		end
		if usage == hid_escape then
			close_completion()
			return false
		end
		close_completion()
	end
	if usage == hid_enter or usage == hid_numpad_enter then
		submit_input()
		return false
	end
	if usage == hid_backspace then
		if control then
			monitor_editor.backspace_word()
		else
			monitor_editor.backspace()
		end
		return true
	end
	if usage == hid_tab then
		local match_count<const> = monitor_editor.complete()
		if match_count > 1 then
			*monitor_completion_active = 1
			*monitor_completion_count = match_count
			*monitor_completion_selection = 0
			monitor_editor.show_candidates(0)
		end
		return false
	end
	if usage == hid_escape then
		monitor_editor.clear()
		return false
	end
	if usage == hid_home then
		monitor_editor.home()
		return false
	end
	if usage == hid_end then
		monitor_editor.move_end()
		return false
	end
	if usage == hid_delete then
		if control then
			monitor_editor.delete_word()
		else
			monitor_editor.delete()
		end
		return true
	end
	if usage == hid_left then
		if control then
			monitor_editor.word_left()
		else
			monitor_editor.left()
		end
		return true
	end
	if usage == hid_right then
		if control then
			monitor_editor.word_right()
		else
			monitor_editor.right()
		end
		return true
	end
	if usage == hid_up then
		monitor_editor.previous()
		return true
	end
	if usage == hid_down then
		monitor_editor.next()
		return true
	end
	if usage == hid_page_up then
		terminal.scroll_view(terminal.page_rows)
		return true
	end
	if usage == hid_page_down then
		terminal.scroll_view(-terminal.page_rows)
		return true
	end
	local code<const> = map_hid_key(usage, shift)
	if code >= ascii_space then
		monitor_editor.insert(code)
		return true
	end
	return false
end

local hid_usage_high<const> = function(word, usage)
	return ((word >> (usage & 31)) & 1) ~= 0
end

local scan_keyboard<const> = function()
	local current<const>: *word = monitor_current_keys
	local previous<const>: *word = monitor_previous_keys
	for index = 0, 7 do
		current[index] = input_keys[index]
	end
	local shift<const> = hid_usage_high(current[hid_left_shift >> 5], hid_left_shift) or hid_usage_high(current[hid_right_shift >> 5], hid_right_shift)
	local control<const> = hid_usage_high(current[hid_left_control >> 5], hid_left_control) or hid_usage_high(current[hid_right_control >> 5], hid_right_control)
	local pressed_usage = 0
	for usage = hid_first_key, hid_last_key do
		if hid_usage_high(current[usage >> 5], usage) and not hid_usage_high(previous[usage >> 5], usage) then
			if process_hid_key(usage, shift, control) then
				pressed_usage = usage
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
			process_hid_key(repeat_usage, shift, control)
			*monitor_repeat_frame = *monitor_repeat_frame + repeat_interval_frames
		end
	end
	for index = 0, 7 do
		previous[index] = current[index]
	end
	*monitor_frame = *monitor_frame + 1
	if *monitor_pager_active == 0 then
		if (*monitor_frame & 31) < 16 then
			terminal.show_cursor()
		else
			terminal.hide_cursor()
		end
	end
end

function monitor.enter()
	-- Nested VBlank IRQ entry overwrites CP0 latches, so preserve the interrupted
	-- context before the monitor enables maskable supervisor interrupts.
	*monitor_saved_status = cop0.status
	*monitor_saved_cause = cop0.cause
	*monitor_saved_epc = cop0.epc
	*monitor_saved_bad_address = cop0.bad_address
	*monitor_saved_irq_mask = *irq_mask

	*irq_mask = 0
	-- Blank scanout before waiting for the next publication boundary. The
	-- monitor is one-way, so accepted cart GPU work retires instead of being
	-- captured or restored.
	gx_gpu.disable_display()
	gx_gpu.ack_irq()
	*irq_ack = 0xffffffff
	vblank.clear()
	*irq_mask = irq_dma_done | irq_vblank | irq_gpu
	cop0.status = *monitor_saved_status | 1
	dma_transfer.abort()
	vblank.wait()

	initialize_input()
	monitor_editor.open()
	monitor_commands.open(
		*monitor_saved_status,
		*monitor_saved_cause,
		*monitor_saved_epc,
		*monitor_saved_bad_address,
		*monitor_saved_irq_mask)
	gx_gpu.reset_256x192_pal()
	gx_gpu.disable_display()
	local system_texture<const> = romdir.resource('gx_system_texture')
	dma_transfer.copy_to_gp0(system_texture.addr, system_texture.len >> 2)
	terminal.open()
	terminal.write('BMSX BIOS MONITOR\n', palette_prompt)
	monitor_commands.start_fault()
	pump_output(terminal.page_rows)
	terminal.flush()
	gx_gpu.enable_display()
	vblank.wait()

	while true do
		*input_control = input_arm
		vblank.wait()
		scan_keyboard()
		terminal.flush()
	end
end

return monitor
