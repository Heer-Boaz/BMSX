local terminal<const> = require('bios/terminal')
local layout<const> = require('bios/terminal_layout')

local byte<const> = __bmsx_string_byte

local monitor_commands<const> = {}
local system_control<const>: *word = 0x08010350

local command_not_found<const> = 0xffffffff
local producer_unknown<const> = 0xfffffffe
local producer_usage<const> = 0xfffffffd
local producer_none<const> = 0xfffffffc
local system_reset<const> = 0x00000001
local row_done<const> = 1
local row_more<const> = 2
local action_none<const> = 0
local action_output<const> = 1
local action_clear<const> = 2

local palette_text<const> = terminal.palette_text
local palette_error<const> = terminal.palette_error
local palette_accent<const> = terminal.palette_accent
local terminal_columns<const> = layout.columns
local ascii_space<const> = 32
local ascii_digit_0<const> = 48
local ascii_digit_9<const> = 57
local ascii_upper_a<const> = 65
local ascii_upper_f<const> = 70
local ascii_lower_a<const> = 97
local ascii_lower_f<const> = 102
local ascii_lower_z<const> = 122

local command_clear<const> = 1
local command_fault<const> = 2
local command_help<const> = 3
local command_memory<const> = 4
local command_reboot<const> = 5
local command_registers<const> = 6

struct monitor_command
	name: string
	usage: string
	description: string
	kind: u8
end

rodata command_registry: monitor_command[] = {
	{ name = 'CLS', usage = 'CLS', description = 'CLEAR TERMINAL OUTPUT', kind = command_clear },
	{ name = 'FAULT', usage = 'FAULT', description = 'SHOW SAVED FAULT STATE', kind = command_fault },
	{ name = 'HELP', usage = 'HELP [COMMAND]', description = 'LIST COMMANDS OR SHOW HELP', kind = command_help },
	{ name = 'MEM', usage = 'MEM <HEX ADDRESS> [WORDS]', description = 'READ MEMORY WORDS', kind = command_memory },
	{ name = 'REBOOT', usage = 'REBOOT', description = 'RESET THE MACHINE', kind = command_reboot },
	{ name = 'REGS', usage = 'REGS', description = 'SHOW CP0 AND IRQ STATE', kind = command_registers },
}

bss monitor_command_producer: word
bss monitor_command_cursor: word
bss monitor_command_value: word
bss monitor_command_address: word
bss monitor_command_remaining: word
bss monitor_context_status: word
bss monitor_context_cause: word
bss monitor_context_epc: word
bss monitor_context_bad_address: word
bss monitor_context_irq_mask: word

monitor_commands.action_none = action_none
monitor_commands.action_output = action_output
monitor_commands.action_clear = action_clear
monitor_commands.row_done = row_done
monitor_commands.row_more = row_more

local uppercase<const> = function(code)
	if code >= ascii_lower_a and code <= ascii_lower_z then
		return code - (ascii_lower_a - ascii_upper_a)
	end
	return code
end

local skip_spaces<const> = function(line, index, length)
	local source<const>: *word = line
	while index < length and source[index] == ascii_space do
		index = index + 1
	end
	return index
end

local command_at<const> = function(line, start_index, length)
	local source<const>: *word = line
	for command = 0, #command_registry - 1 do
		local name<const> = command_registry[command].name
		if #name == length then
			local matches = true
			for index = 0, length - 1 do
				if uppercase(source[start_index + index]) ~= byte(name, index + 1) then
					matches = false
					break
				end
			end
			if matches then
				return command
			end
		end
	end
	return command_not_found
end

local command_span<const> = function(line, length)
	local source<const>: *word = line
	local start_index<const> = skip_spaces(source, 0, length)
	local end_index = start_index
	while end_index < length and source[end_index] ~= ascii_space do
		end_index = end_index + 1
	end
	return command_at(source, start_index, end_index - start_index), end_index
end

local matches_prefix<const> = function(name, line, start_index, length)
	local source<const>: *word = line
	if #name < length then
		return false
	end
	for index = 0, length - 1 do
		if byte(name, index + 1) ~= uppercase(source[start_index + index]) then
			return false
		end
	end
	return true
end

local completion_match<const> = function(name, line, start_index, length, capacity)
	return start_index + #name <= capacity and matches_prefix(name, line, start_index, length)
end

local completion_start<const> = function(line, length, cursor)
	if cursor ~= length then
		return -1
	end
	local source<const>: *word = line
	local start_index<const> = skip_spaces(source, 0, cursor)
	for index = start_index, cursor - 1 do
		if source[index] == ascii_space then
			return -1
		end
	end
	return start_index
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

local parse_hex<const> = function(line, index, length)
	local source<const>: *word = line
	index = skip_spaces(source, index, length)
	if index + 1 < length and source[index] == ascii_digit_0 and uppercase(source[index + 1]) == 88 then
		index = index + 2
	end
	local value = 0
	local digits = 0
	while index < length and source[index] ~= ascii_space do
		local digit<const> = hex_digit(source[index])
		if digit < 0 then
			return 0, index, 0
		end
		value = (value << 4) | digit
		digits = digits + 1
		index = index + 1
	end
	return value & 0xffffffff, index, digits
end

local parse_count<const> = function(line, index, length)
	local source<const>: *word = line
	index = skip_spaces(source, index, length)
	local base = 10
	if index + 1 < length and source[index] == ascii_digit_0 and uppercase(source[index + 1]) == 88 then
		base = 16
		index = index + 2
	end
	local value = 0
	local digits = 0
	while index < length and source[index] ~= ascii_space do
		local digit<const> = hex_digit(source[index])
		if digit < 0 or digit >= base then
			return 0, index, 0
		end
		value = value * base + digit
		digits = digits + 1
		index = index + 1
	end
	return value, index, digits
end

local clear_row<const> = function(row)
	local target<const>: *word = row
	for column = 0, terminal_columns - 1 do
		target[column] = 0
	end
end

local write_text<const> = function(row, column, text, palette)
	local target<const>: *word = row
	for index = 1, #text do
		target[column] = byte(text, index) | (palette << 8)
		column = column + 1
	end
	return column
end

local write_hex<const> = function(row, column, value, palette)
	local target<const>: *word = row
	for shift = 28, 0, -4 do
		local digit<const> = (value >> shift) & 0x0f
		target[column] = (digit < 10 and ascii_digit_0 + digit or ascii_upper_a + digit - 10) | (palette << 8)
		column = column + 1
	end
	return column
end

local start_usage<const> = function(command)
	*monitor_command_producer = producer_usage
	*monitor_command_value = command
	*monitor_command_cursor = 0
	return action_output
end

local arguments_end<const> = function(line, index, length)
	return skip_spaces(line, index, length) == length
end

function monitor_commands.open(status, cause, epc, bad_address, irq_mask)
	*monitor_context_status = status
	*monitor_context_cause = cause
	*monitor_context_epc = epc
	*monitor_context_bad_address = bad_address
	*monitor_context_irq_mask = irq_mask
	*monitor_command_producer = producer_none
end

function monitor_commands.start_fault()
	for command = 0, #command_registry - 1 do
		if command_registry[command].kind == command_fault then
			*monitor_command_producer = command
			*monitor_command_cursor = 0
			return
		end
	end
end

function monitor_commands.complete(line, length, cursor, capacity)
	local source<const>: *word = line
	local start_index<const> = completion_start(source, length, cursor)
	if start_index < 0 then
		return length, cursor, 0, false
	end
	local prefix_length<const> = cursor - start_index
	local first_command = command_not_found
	local common_length = 0
	local match_count = 0
	for command = 0, #command_registry - 1 do
		local name<const> = command_registry[command].name
		if completion_match(name, source, start_index, prefix_length, capacity) then
			if match_count == 0 then
				first_command = command
				common_length = #name
			else
				local first_name<const> = command_registry[first_command].name
				local limit = common_length
				if #name < limit then
					limit = #name
				end
				local common = 0
				while common < limit and byte(first_name, common + 1) == byte(name, common + 1) do
					common = common + 1
				end
				common_length = common
			end
			match_count = match_count + 1
		end
	end
	if match_count == 0 then
		return length, cursor, 0, false
	end
	local first_name<const> = command_registry[first_command].name
	local changed = common_length ~= prefix_length
	for index = 0, common_length - 1 do
		local code<const> = byte(first_name, index + 1)
		if source[start_index + index] ~= code then
			changed = true
			source[start_index + index] = code
		end
	end
	local next_length = start_index + common_length
	if match_count == 1 and next_length < capacity then
		source[next_length] = ascii_space
		next_length = next_length + 1
		changed = true
	end
	return next_length, next_length, match_count, changed
end

function monitor_commands.fill_candidates(row, line, length, cursor, capacity, selected)
	clear_row(row)
	local source<const>: *word = line
	local start_index<const> = completion_start(source, length, cursor)
	local prefix_length<const> = cursor - start_index
	local column = 0
	local ordinal = 0
	for command = 0, #command_registry - 1 do
		local name<const> = command_registry[command].name
		if completion_match(name, source, start_index, prefix_length, capacity) then
			if column ~= 0 then
				column = write_text(row, column, '  ', palette_text)
			end
			column = write_text(row, column, name, ordinal == selected and palette_accent or palette_text)
			ordinal = ordinal + 1
		end
	end
end

function monitor_commands.accept_candidate(line, length, cursor, capacity, selected)
	local target<const>: *word = line
	local start_index<const> = completion_start(target, length, cursor)
	local prefix_length<const> = cursor - start_index
	local ordinal = 0
	for command = 0, #command_registry - 1 do
		local name<const> = command_registry[command].name
		if completion_match(name, target, start_index, prefix_length, capacity) then
			if ordinal == selected then
				for index = 1, #name do
					target[start_index + index - 1] = byte(name, index)
				end
				local next_length<const> = start_index + #name
				if next_length < capacity then
					target[next_length] = ascii_space
					return next_length + 1
				end
				return next_length
			end
			ordinal = ordinal + 1
		end
	end
end

function monitor_commands.start(line, length)
	local command<const>, argument_index<const> = command_span(line, length)
	if command == command_not_found then
		if skip_spaces(line, 0, length) == length then
			return action_none
		end
		*monitor_command_producer = producer_unknown
		*monitor_command_cursor = 0
		return action_output
	end

	local entry<const>: *monitor_command = &command_registry[command]
	if entry.kind == command_clear then
		if not arguments_end(line, argument_index, length) then
			return start_usage(command)
		end
		return action_clear
	end
	if entry.kind == command_reboot then
		if not arguments_end(line, argument_index, length) then
			return start_usage(command)
		end
		*system_control = system_reset
		return action_none
	end
	if entry.kind == command_fault or entry.kind == command_registers then
		if not arguments_end(line, argument_index, length) then
			return start_usage(command)
		end
		*monitor_command_producer = command
		*monitor_command_cursor = 0
		return action_output
	end
	if entry.kind == command_help then
		local index<const> = skip_spaces(line, argument_index, length)
		*monitor_command_producer = command
		*monitor_command_cursor = 0
		if index == length then
			*monitor_command_value = command_not_found
			return action_output
		end
		local argument_end = index
		local source<const>: *word = line
		while argument_end < length and source[argument_end] ~= ascii_space do
			argument_end = argument_end + 1
		end
		if not arguments_end(source, argument_end, length) then
			return start_usage(command)
		end
		local help_command<const> = command_at(source, index, argument_end - index)
		if help_command == command_not_found then
			*monitor_command_producer = producer_unknown
		else
			*monitor_command_value = help_command
		end
		return action_output
	end

	local address<const>, address_end<const>, address_digits<const> = parse_hex(line, argument_index, length)
	if address_digits == 0 then
		return start_usage(command)
	end
	local count_index<const> = skip_spaces(line, address_end, length)
	local word_count = 16
	if count_index < length then
		local parsed_count<const>, count_end<const>, count_digits<const> = parse_count(line, count_index, length)
		if count_digits == 0 or parsed_count == 0 or not arguments_end(line, count_end, length) then
			return start_usage(command)
		end
		word_count = parsed_count
	end
	*monitor_command_producer = command
	*monitor_command_address = address
	*monitor_command_remaining = word_count
	return action_output
end

function monitor_commands.cancel()
	*monitor_command_producer = producer_none
end

function monitor_commands.next_row(row)
	clear_row(row)
	local producer<const> = *monitor_command_producer
	if producer == producer_unknown then
		write_text(row, 0, 'UNKNOWN COMMAND', palette_error)
		*monitor_command_producer = producer_none
		return row_done
	end
	if producer == producer_usage then
		local command<const>: *monitor_command = &command_registry[*monitor_command_value]
		local column<const> = write_text(row, 0, 'USAGE: ', palette_error)
		write_text(row, column, command.usage, palette_text)
		*monitor_command_producer = producer_none
		return row_done
	end
	local entry<const>: *monitor_command = &command_registry[producer]
	if entry.kind == command_fault or entry.kind == command_registers then
		local cursor<const> = *monitor_command_cursor
		local column = 0
		if cursor == 0 then
			column = write_text(row, 0, 'CAUSE   ', palette_accent)
			write_hex(row, column, *monitor_context_cause, palette_text)
		elseif cursor == 1 then
			column = write_text(row, 0, 'EPC     ', palette_accent)
			write_hex(row, column, *monitor_context_epc, palette_text)
		elseif cursor == 2 then
			column = write_text(row, 0, 'BADADDR ', palette_accent)
			write_hex(row, column, *monitor_context_bad_address, palette_text)
		elseif cursor == 3 then
			column = write_text(row, 0, 'STATUS  ', palette_accent)
			write_hex(row, column, *monitor_context_status, palette_text)
		else
			column = write_text(row, 0, 'IRQMASK ', palette_accent)
			write_hex(row, column, *monitor_context_irq_mask, palette_text)
		end
		*monitor_command_cursor = cursor + 1
		if (entry.kind == command_fault and cursor == 2) or cursor == 4 then
			*monitor_command_producer = producer_none
			return row_done
		end
		return row_more
	end
	if entry.kind == command_help then
		local selected<const> = *monitor_command_value
		local cursor<const> = *monitor_command_cursor
		if selected ~= command_not_found then
			local selected_command<const>: *monitor_command = &command_registry[selected]
			if cursor == 0 then
				local column<const> = write_text(row, 0, 'USAGE: ', palette_accent)
				write_text(row, column, selected_command.usage, palette_text)
				*monitor_command_cursor = 1
				return row_more
			end
			write_text(row, 0, selected_command.description, palette_text)
			*monitor_command_producer = producer_none
			return row_done
		end
		if cursor == 0 then
			write_text(row, 0, 'COMMAND  DESCRIPTION', palette_accent)
			*monitor_command_cursor = 1
			return row_more
		end
		local command<const>: *monitor_command = &command_registry[cursor - 1]
		write_text(row, 0, command.name, palette_accent)
		write_text(row, 9, command.description, palette_text)
		*monitor_command_cursor = cursor + 1
		if cursor == #command_registry then
			*monitor_command_producer = producer_none
			return row_done
		end
		return row_more
	end

	local address = *monitor_command_address
	local remaining = *monitor_command_remaining
	local column<const> = write_hex(row, 0, address, palette_accent)
	local target<const>: *word = row
	target[column] = 58 | (palette_accent << 8)
	local output_column = column + 1
	local words = 4
	if remaining < words then
		words = remaining
	end
	for index = 0, words - 1 do
		target[output_column] = ascii_space | (palette_text << 8)
		output_column = write_hex(target, output_column + 1, mem[address], palette_text)
		address = address + 4
	end
	remaining = remaining - words
	*monitor_command_address = address
	*monitor_command_remaining = remaining
	if remaining == 0 then
		*monitor_command_producer = producer_none
		return row_done
	end
	return row_more
end

return monitor_commands
