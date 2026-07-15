local romdir<const> = require('system/romdir')

local byte<const> = __bmsx_string_byte
local terminal<const> = {}

local character_control<const>: *word = 0x08010350
local character_palette_address<const>: *word = 0x08010354
local character_palette_data<const>: *word = 0x08010358
local character_glyph_address<const>: *word = 0x0801035c
local character_glyph_data<const>: *word = 0x08010360
local character_cell_address<const>: *word = 0x08010364
local character_cell_data<const>: *word = 0x08010368
local character_font<const>: *word = romdir.resource('gx_character_font').addr

local character_enable<const> = 0x00000001
local plane_columns<const> = 160
local plane_rows<const> = 80
local terminal_columns<const> = 64
local terminal_rows<const> = 32
local ascii_newline<const> = 10
local ascii_digit_0<const> = 48
local ascii_upper_a<const> = 65
local cursor_cell<const> = 0x0000015f

terminal.palette_text = 1
terminal.palette_error = 2
terminal.palette_accent = 3

bss terminal_cells: word[2048]
bss terminal_dirty_first_columns: word[32]
bss terminal_dirty_last_columns: word[32]
bss terminal_dirty_rows: word
bss terminal_first_row: word
bss terminal_cursor_row: word
bss terminal_cursor_column: word
bss terminal_cursor_visible: word

local mark_cell_dirty<const> = function(row, column)
	local row_bit<const> = 1 << row
	local first_columns<const>: *word = terminal_dirty_first_columns
	local last_columns<const>: *word = terminal_dirty_last_columns
	if (*terminal_dirty_rows & row_bit) == 0 then
		*terminal_dirty_rows = *terminal_dirty_rows | row_bit
		first_columns[row] = column
		last_columns[row] = column + 1
		return
	end
	if column < first_columns[row] then
		first_columns[row] = column
	end
	if column >= last_columns[row] then
		last_columns[row] = column + 1
	end
end

local mark_screen_dirty<const> = function()
	local first_columns<const>: *word = terminal_dirty_first_columns
	local last_columns<const>: *word = terminal_dirty_last_columns
	*terminal_dirty_rows = 0xffffffff
	for row = 0, terminal_rows - 1 do
		first_columns[row] = 0
		last_columns[row] = terminal_columns
	end
end

local buffer_row<const> = function(screen_row)
	return (*terminal_first_row + screen_row) % terminal_rows
end

local set_cell<const> = function(row, column, word)
	local cells<const>: *word = terminal_cells
	local index<const> = buffer_row(row) * terminal_columns + column
	if cells[index] == word then
		return
	end
	cells[index] = word
	mark_cell_dirty(row, column)
end

local clear_buffer_row<const> = function(screen_row)
	local cells<const>: *word = terminal_cells
	local offset<const> = buffer_row(screen_row) * terminal_columns
	for column = 0, terminal_columns - 1 do
		if cells[offset + column] ~= 0 then
			cells[offset + column] = 0
			mark_cell_dirty(screen_row, column)
		end
	end
end

local mark_cursor_dirty<const> = function()
	if *terminal_cursor_visible ~= 0 and *terminal_cursor_column < terminal_columns then
		mark_cell_dirty(*terminal_cursor_row, *terminal_cursor_column)
	end
end

local line_feed<const> = function()
	mark_cursor_dirty()
	*terminal_cursor_column = 0
	if *terminal_cursor_row + 1 < terminal_rows then
		*terminal_cursor_row = *terminal_cursor_row + 1
		clear_buffer_row(*terminal_cursor_row)
	else
		*terminal_first_row = (*terminal_first_row + 1) % terminal_rows
		clear_buffer_row(terminal_rows - 1)
		mark_screen_dirty()
	end
	mark_cursor_dirty()
end

local reset_screen<const> = function()
	local cells<const>: *word = terminal_cells
	for index = 0, terminal_columns * terminal_rows - 1 do
		cells[index] = 0
	end
	*terminal_dirty_rows = 0
	*terminal_first_row = 0
	*terminal_cursor_row = 0
	*terminal_cursor_column = 0
	*terminal_cursor_visible = 0
end

function terminal.open()
	reset_screen()
	*character_control = 0
	*character_palette_address = 0
	*character_palette_data = 0
	*character_palette_data = 0x0000ffff
	*character_palette_data = 0x0000801f
	*character_palette_data = 0x0000ffe0
	for index = 4, 15 do
		*character_palette_data = 0
	end
	*character_glyph_address = 0
	for index = 0, 255 do
		*character_glyph_data = character_font[index]
	end
	-- A cart may have programmed any cell while the BIOS was inactive. Clear the
	-- entire hardware plane, not merely the 64x32 cells visible in 256x192 mode.
	*character_cell_address = 0
	for index = 0, plane_columns * plane_rows - 1 do
		*character_cell_data = 0
	end
	*character_control = character_enable
end

function terminal.close()
	*character_control = 0
	*terminal_dirty_rows = 0
end

function terminal.put(row, column, code, palette)
	set_cell(row, column, code | (palette << 8))
end

function terminal.write_at(row, column, text, palette)
	for index = 1, #text do
		set_cell(row, column + index - 1, byte(text, index) | (palette << 8))
	end
end

function terminal.write_code(code, palette)
	if code == ascii_newline then
		line_feed()
		return
	end
	if *terminal_cursor_column == terminal_columns then
		line_feed()
	end
	mark_cursor_dirty()
	set_cell(*terminal_cursor_row, *terminal_cursor_column, code | (palette << 8))
	*terminal_cursor_column = *terminal_cursor_column + 1
	mark_cursor_dirty()
end

function terminal.write(text, palette)
	for index = 1, #text do
		terminal.write_code(byte(text, index), palette)
	end
end

function terminal.write_hex_word(value, palette)
	for shift = 28, 0, -4 do
		local digit<const> = (value >> shift) & 0x0f
		terminal.write_code(digit < 10 and ascii_digit_0 + digit or ascii_upper_a + digit - 10, palette)
	end
end

function terminal.backspace()
	if *terminal_cursor_column == 0 then
		return
	end
	mark_cursor_dirty()
	*terminal_cursor_column = *terminal_cursor_column - 1
	set_cell(*terminal_cursor_row, *terminal_cursor_column, 0)
	mark_cursor_dirty()
end

function terminal.show_cursor()
	if *terminal_cursor_visible == 0 then
		*terminal_cursor_visible = 1
		mark_cursor_dirty()
	end
end

function terminal.flush()
	local dirty_rows<const> = *terminal_dirty_rows
	if dirty_rows == 0 then
		return
	end
	local cells<const>: *word = terminal_cells
	local first_columns<const>: *word = terminal_dirty_first_columns
	local last_columns<const>: *word = terminal_dirty_last_columns
	for row = 0, terminal_rows - 1 do
		if (dirty_rows & (1 << row)) ~= 0 then
			local first_column<const> = first_columns[row]
			local last_column<const> = last_columns[row]
			local source<const> = buffer_row(row) * terminal_columns
			*character_cell_address = row * plane_columns + first_column
			for column = first_column, last_column - 1 do
				if *terminal_cursor_visible ~= 0 and row == *terminal_cursor_row and column == *terminal_cursor_column then
					*character_cell_data = cursor_cell
				else
					*character_cell_data = cells[source + column]
				end
			end
		end
	end
	*terminal_dirty_rows = 0
end

return terminal
