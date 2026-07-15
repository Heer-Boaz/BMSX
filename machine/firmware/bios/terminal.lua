local romdir<const> = require('system/romdir')

local byte<const> = __bmsx_string_byte
local terminal<const> = {}

local display2_start<const>: *word = 0x08010350
local display2_size<const>: *word = 0x08010354
local compositor_control<const>: *word = 0x08010358
local system_vram_position<const>: *word = 0x0801035c
local system_vram_size<const>: *word = 0x08010360
local system_vram_control<const>: *word = 0x08010364
local system_vram_data<const>: *word = 0x08010368
local terminal_font<const>: *word = romdir.resource('bios_terminal_font').addr

local system_vram_start<const> = 0x00000001
local system_vram_reset<const> = 0x00000002
local compositor_display2_enable<const> = 0x00000001
local terminal_system_vram_y<const> = 64
local terminal_display2_start<const> = 0x00010200
local terminal_display2_size<const> = 0x00c00100
local glyph_width<const> = 4
local glyph_height<const> = 6
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
bss terminal_palette: word[4]
bss terminal_dirty_first_columns: word[32]
bss terminal_dirty_last_columns: word[32]
bss terminal_dirty_rows: word
bss terminal_first_row: word
bss terminal_cursor_row: word
bss terminal_cursor_column: word
bss terminal_cursor_visible: word
bss terminal_display_enabled: word

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
	*terminal_display_enabled = 0
	local palette<const>: *word = terminal_palette
	palette[0] = 0x0000
	palette[1] = 0xffff
	palette[2] = 0x801f
	palette[3] = 0xffe0
	*compositor_control = 0
	*system_vram_control = system_vram_reset
	mark_screen_dirty()
end

function terminal.close()
	*compositor_control = 0
	*terminal_display_enabled = 0
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
	local palette<const>: *word = terminal_palette
	local first_columns<const>: *word = terminal_dirty_first_columns
	local last_columns<const>: *word = terminal_dirty_last_columns
	for row = 0, terminal_rows - 1 do
		if (dirty_rows & (1 << row)) ~= 0 then
			local first_column<const> = first_columns[row]
			local last_column<const> = last_columns[row]
			local source<const> = buffer_row(row) * terminal_columns
			local transfer_width<const> = (last_column - first_column) * glyph_width
			*system_vram_position = first_column * glyph_width | ((terminal_system_vram_y + row * glyph_height) << 16)
			*system_vram_size = transfer_width | (glyph_height << 16)
			*system_vram_control = system_vram_start
			for glyph_row = 0, glyph_height - 1 do
				for column = first_column, last_column - 1 do
					local cell = cells[source + column]
					if *terminal_cursor_visible ~= 0 and row == *terminal_cursor_row and column == *terminal_cursor_column then
						cell = cursor_cell
					end
					local bits<const> = (terminal_font[cell & 0xff] >> (glyph_row << 2)) & 0x0f
					local color<const> = palette[(cell >> 8) & 0x03]
					local pixel0<const> = (bits & 0x01) ~= 0 and color or 0
					local pixel1<const> = (bits & 0x02) ~= 0 and color or 0
					local pixel2<const> = (bits & 0x04) ~= 0 and color or 0
					local pixel3<const> = (bits & 0x08) ~= 0 and color or 0
					*system_vram_data = pixel0 | (pixel1 << 16)
					*system_vram_data = pixel2 | (pixel3 << 16)
				end
			end
		end
	end
	*terminal_dirty_rows = 0
	if *terminal_display_enabled == 0 then
		-- Both register writes latch on the same VBlank as the completed first
		-- framebuffer upload, so scanout never observes uninitialized terminal VRAM.
		*display2_start = terminal_display2_start
		*display2_size = terminal_display2_size
		*compositor_control = compositor_display2_enable
		*terminal_display_enabled = 1
	end
end

return terminal
