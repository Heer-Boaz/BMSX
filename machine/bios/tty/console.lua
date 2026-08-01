local terminal<const> = require('tty/terminal')

local byte<const> = __bmsx_string_byte
local console<const> = {}

local system_print_char<const>: *word = 0x0801022c
local system_print_flush<const>: *word = 0x08010230
local palette_text<const> = terminal.palette_text
local history_capacity<const> = 8192
local history_mask<const> = history_capacity - 1
local ascii_newline<const> = 10
local ascii_space<const> = 32
local replacement_glyph<const> = 63

bss console_history: u8[history_capacity]
bss console_history_read_index: word
bss console_history_byte_count: word

function console.write(text)
	local history<const>: *u8 = console_history
	local read_index = *console_history_read_index
	local count = *console_history_byte_count
	local index = 1
	local code = byte(text, index)
	while code ~= nil do
		if count == history_capacity then
			read_index = (read_index + 1) & history_mask
			count = count - 1
		end
		history[(read_index + count) & history_mask] = code <= 0xff and code or replacement_glyph
		count = count + 1
		*system_print_char = code
		index = index + 1
		code = byte(text, index)
	end
	*console_history_read_index = read_index
	*console_history_byte_count = count
end

function console.end_line()
	local history<const>: *u8 = console_history
	local read_index = *console_history_read_index
	local count = *console_history_byte_count
	if count == history_capacity then
		read_index = (read_index + 1) & history_mask
		count = count - 1
		*console_history_read_index = read_index
	end
	history[(read_index + count) & history_mask] = ascii_newline
	*console_history_byte_count = count + 1
	*system_print_flush = 1
end

function console.flush()
	local history<const>: *u8 = console_history
	local read_index = *console_history_read_index
	local count = *console_history_byte_count
	while count ~= 0 do
		terminal.write_code(history[read_index], palette_text)
		read_index = (read_index + 1) & history_mask
		count = count - 1
	end
	*console_history_read_index = read_index
	*console_history_byte_count = 0
end

function console.write_line(text, palette)
	local index = 1
	local code = byte(text, index)
	while code ~= nil do
		*system_print_char = code
		terminal.write_code(code <= 0xff and code or replacement_glyph, palette)
		index = index + 1
		code = byte(text, index)
	end
	*system_print_flush = 1
	terminal.write_code(ascii_newline, palette)
end

function console.write_row(row)
	local source<const>: *u16 = row
	local last_column = terminal.columns - 1
	while last_column >= 0 and source[last_column] == 0 do
		last_column = last_column - 1
	end
	for column = 0, last_column do
		local code<const> = source[column] & 0xff
		*system_print_char = code ~= 0 and code or ascii_space
	end
	*system_print_flush = 1
	terminal.append_row(row)
end

return console
