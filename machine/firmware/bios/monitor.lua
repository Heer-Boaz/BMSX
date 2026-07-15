local terminal<const> = require('bios/terminal')
local vblank<const> = require('bios/vblank')

local byte<const> = __bmsx_string_byte
local monitor<const> = {}

local irq_ack<const>: *word = 0x0800000c
local irq_mask<const>: *word = 0x08000010
local input_control<const>: *word = 0x0800006c
local input_keys<const>: *word[8] = 0x08000074
local system_control<const>: *word = 0x0801036c

local irq_vblank<const> = 0x0004
local input_arm<const> = 0x00000001
local system_reset<const> = 0x00000001
local cause_nmi<const> = 0x00010000
local cause_coprocessor_unusable<const> = 0x0000002c

local input_capacity<const> = 60
local palette_text<const> = terminal.palette_text
local palette_error<const> = terminal.palette_error
local palette_prompt<const> = terminal.palette_accent

local ascii_backspace<const> = 8
local ascii_newline<const> = 10
local ascii_space<const> = 32
local ascii_digit_0<const> = 48
local ascii_digit_9<const> = 57
local ascii_upper_a<const> = 65
local ascii_upper_f<const> = 70
local ascii_lower_a<const> = 97
local ascii_lower_f<const> = 102
local ascii_lower_z<const> = 122

local hid_enter<const> = 40
local hid_backspace<const> = 42
local hid_space<const> = 44
local hid_first_key<const> = 4
local hid_last_key<const> = 56
local hid_left_shift<const> = 225
local hid_right_shift<const> = 229

local repeat_delay_frames<const> = 18
local repeat_interval_frames<const> = 4

bss monitor_input_line: word[60]
bss monitor_current_keys: word[8]
bss monitor_previous_keys: word[8]
bss monitor_input_length: word
bss monitor_frame: word
bss monitor_repeat_usage: word
bss monitor_repeat_frame: word
bss monitor_action: word
bss monitor_saved_status: word
bss monitor_saved_cause: word
bss monitor_saved_epc: word
bss monitor_saved_bad_address: word
bss monitor_saved_irq_mask: word
bss monitor_resume_epc: word
bss monitor_resumable: word

local initialize_input<const> = function()
	*monitor_input_length = 0
	*monitor_frame = 0
	*monitor_repeat_usage = 0
	*monitor_repeat_frame = 0
	*monitor_action = 0
	local input_line<const>: *word = monitor_input_line
	for index = 0, input_capacity - 1 do
		input_line[index] = 0
	end
	local current_keys<const>: *word = monitor_current_keys
	local previous_keys<const>: *word = monitor_previous_keys
	for index = 0, 7 do
		current_keys[index] = 0
		previous_keys[index] = 0
	end
end

local line_code<const> = function(index)
	local line<const>: *word = monitor_input_line
	local code = line[index]
	if code >= ascii_lower_a and code <= ascii_lower_z then
		code = code - (ascii_lower_a - ascii_upper_a)
	end
	return code
end

local line_equals<const> = function(text)
	if *monitor_input_length ~= #text then
		return false
	end
	for index = 0, #text - 1 do
		if line_code(index) ~= byte(text, index + 1) then
			return false
		end
	end
	return true
end

local line_starts_command<const> = function(command)
	if *monitor_input_length < #command then
		return false
	end
	for index = 0, #command - 1 do
		if line_code(index) ~= byte(command, index + 1) then
			return false
		end
	end
	return *monitor_input_length == #command or line_code(#command) == ascii_space
end

local hex_digit<const> = function(code)
	if code >= ascii_digit_0 and code <= ascii_digit_9 then
		return code - ascii_digit_0
	end
	if code >= ascii_upper_a and code <= ascii_upper_f then
		return code - ascii_upper_a + 10
	end
	if code >= ascii_lower_a and code <= ascii_lower_f then
		return code - ascii_lower_a + 10
	end
	return -1
end

local print_fault<const> = function()
	terminal.write('CAUSE ', palette_prompt)
	terminal.write_hex_word(*monitor_saved_cause, palette_text)
	terminal.write_code(ascii_newline, palette_text)
	terminal.write('EPC   ', palette_prompt)
	terminal.write_hex_word(*monitor_saved_epc, palette_text)
	terminal.write_code(ascii_newline, palette_text)
	terminal.write('BAD   ', palette_prompt)
	terminal.write_hex_word(*monitor_saved_bad_address, palette_text)
	terminal.write_code(ascii_newline, palette_text)
end

local print_registers<const> = function()
	print_fault()
	terminal.write('STATUS ', palette_prompt)
	terminal.write_hex_word(*monitor_saved_status, palette_text)
	terminal.write_code(ascii_newline, palette_text)
	terminal.write('IRQMASK ', palette_prompt)
	terminal.write_hex_word(*monitor_saved_irq_mask, palette_text)
	terminal.write_code(ascii_newline, palette_text)
end

local parse_memory_address<const> = function()
	local index = 3
	while index < *monitor_input_length and line_code(index) == ascii_space do
		index = index + 1
	end
	if index + 1 < *monitor_input_length and line_code(index) == ascii_digit_0 and line_code(index + 1) == 88 then
		index = index + 2
	end
	local address = 0
	local digits = 0
	while index < *monitor_input_length do
		local code<const> = line_code(index)
		if code == ascii_space then
			break
		end
		local digit<const> = hex_digit(code)
		if digit < 0 then
			return -1
		end
		address = (address << 4) | digit
		digits = digits + 1
		index = index + 1
	end
	while index < *monitor_input_length and line_code(index) == ascii_space do
		index = index + 1
	end
	if digits == 0 or index ~= *monitor_input_length then
		return -1
	end
	return address & 0xffffffff
end

local dump_memory<const> = function()
	local address<const> = parse_memory_address()
	if address < 0 then
		terminal.write('USAGE: MEM <HEX ADDRESS>\n', palette_error)
		return
	end
	for index = 0, 3 do
		local word_address<const> = address + index * 4
		terminal.write_hex_word(word_address, palette_prompt)
		terminal.write_code(ascii_space, palette_text)
		terminal.write_hex_word(mem[word_address], palette_text)
		terminal.write_code(ascii_newline, palette_text)
	end
end

local dispatch_command<const> = function()
	local length<const> = *monitor_input_length
	if length == 0 then
		return
	end
	if line_equals('HELP') then
		terminal.write('HELP FAULT REGS MEM CONT REBOOT\n', palette_text)
		return
	end
	if line_equals('FAULT') then
		print_fault()
		return
	end
	if line_equals('REGS') then
		print_registers()
		return
	end
	if line_starts_command('MEM') then
		dump_memory()
		return
	end
	if line_equals('CONT') then
		if *monitor_resumable == 0 then
			terminal.write('FAULT IS NOT RESUMABLE\n', palette_error)
			return
		end
		*monitor_action = 1
		return
	end
	if line_equals('REBOOT') then
		*system_control = system_reset
		return
	end
	terminal.write('UNKNOWN COMMAND\n', palette_error)
end

local write_prompt<const> = function()
	terminal.write('> ', palette_prompt)
end

local submit_input<const> = function()
	terminal.write_code(ascii_newline, palette_text)
	dispatch_command()
	*monitor_input_length = 0
	if *monitor_action == 0 then
		write_prompt()
	end
end

local erase_input<const> = function()
	if *monitor_input_length == 0 then
		return
	end
	*monitor_input_length = *monitor_input_length - 1
	local line<const>: *word = monitor_input_line
	line[*monitor_input_length] = 0
	terminal.backspace()
end

local append_input<const> = function(code)
	if *monitor_input_length == input_capacity then
		return
	end
	local line<const>: *word = monitor_input_line
	line[*monitor_input_length] = code
	*monitor_input_length = *monitor_input_length + 1
	terminal.write_code(code, palette_text)
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
	if usage == hid_enter then return ascii_newline end
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

local process_hid_key<const> = function(usage, shift)
	local code<const> = map_hid_key(usage, shift)
	if code == ascii_newline then
		submit_input()
	elseif code == ascii_backspace then
		erase_input()
	elseif code ~= 0 then
		append_input(code)
	end
	return code
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
	local pressed_usage = 0
	for usage = hid_first_key, hid_last_key do
		if hid_usage_high(current[usage >> 5], usage) and not hid_usage_high(previous[usage >> 5], usage) then
			local code<const> = process_hid_key(usage, shift)
			if code == ascii_backspace or code >= ascii_space then
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
			process_hid_key(repeat_usage, shift)
			*monitor_repeat_frame = *monitor_repeat_frame + repeat_interval_frames
		end
	end
	for index = 0, 7 do
		previous[index] = current[index]
	end
	*monitor_frame = *monitor_frame + 1
end

local leave_monitor<const> = function()
	terminal.close()
	*irq_mask = 0
	cop0.epc = *monitor_resume_epc
	cop0.status = *monitor_saved_status
	*irq_mask = *monitor_saved_irq_mask
end

function monitor.enter()
	-- Nested VBlank IRQ entry overwrites CP0 latches, so preserve the interrupted
	-- context before the monitor enables maskable supervisor interrupts.
	*monitor_saved_status = cop0.status
	*monitor_saved_cause = cop0.cause
	*monitor_saved_epc = cop0.epc
	*monitor_saved_bad_address = cop0.bad_address
	*monitor_saved_irq_mask = *irq_mask
	*monitor_resumable = 0
	*monitor_resume_epc = *monitor_saved_epc
	if *monitor_saved_cause == cause_nmi then
		*monitor_resumable = 1
	elseif *monitor_saved_cause == cause_coprocessor_unusable then
		*monitor_resumable = 1
		*monitor_resume_epc = *monitor_saved_epc + 4
	end

	*irq_mask = 0
	*irq_ack = irq_vblank
	vblank.clear()
	initialize_input()
	terminal.open()
	terminal.write('BMSX BIOS MONITOR\n', palette_prompt)
	print_fault()
	terminal.write('TYPE HELP FOR COMMANDS\n', palette_text)
	write_prompt()
	terminal.show_cursor()
	terminal.flush()

	*irq_mask = irq_vblank
	cop0.status = *monitor_saved_status | 1
	while *monitor_action == 0 do
		*input_control = input_arm
		vblank.wait()
		scan_keyboard()
		terminal.flush()
	end
	leave_monitor()
end

return monitor
