local romdir<const> = require('system/romdir')
local gx_gpu<const> = require('system/gx_gpu')
local gx_command_list<const> = require('bios/gx_command_list')
local layout<const> = require('bios/terminal_layout')

local byte<const> = __bmsx_string_byte
local terminal<const> = {}

local terminal_glyphs<const>: *word = romdir.resource('bios_terminal_glyphs').addr

local glyph_width<const> = 4
local glyph_height<const> = 6
local terminal_columns<const> = layout.columns
local terminal_rows<const> = layout.rows
local scrollback_rows<const> = layout.scrollback_rows
local terminal_width<const> = terminal_columns * glyph_width
local terminal_height<const> = terminal_rows * glyph_height
local ascii_newline<const> = 10
local cursor_cell<const> = 0x0000015f
local terminal_background_word<const> = 0x00000000
local all_rows_dirty<const> = 0xffffffff

terminal.columns = terminal_columns
terminal.rows = terminal_rows
terminal.page_rows = terminal_rows - 1
terminal.palette_text = 1
terminal.palette_error = 2
terminal.palette_accent = 3

bss terminal_cells: word[scrollback_rows * terminal_columns]
bss terminal_status_cells: word[terminal_columns]
bss terminal_palette: word[4]
bss terminal_dirty_first_columns: word[terminal_rows]
bss terminal_dirty_last_columns: word[terminal_rows]
bss terminal_dirty_rows: word
bss terminal_first_buffer_row: word
bss terminal_line_count: word
bss terminal_cursor_line: word
bss terminal_cursor_column: word
bss terminal_cursor_visible: word
bss terminal_view_offset: word
bss terminal_scroll_rows: word
bss terminal_status_visible: word
bss terminal_input_line: word
bss terminal_input_column: word
bss terminal_input_drawn_length: word
bss terminal_command_words: word[terminal_columns * terminal_rows * 4 + 5]

local visible_first_line<const> = function()
	return *terminal_line_count - terminal_rows - *terminal_view_offset
end

local buffer_row_for_line<const> = function(line)
	return (*terminal_first_buffer_row + line) % scrollback_rows
end

local buffer_row_for_screen<const> = function(row)
	return buffer_row_for_line(visible_first_line() + row)
end

local screen_row_for_line<const> = function(line)
	local row<const> = line - visible_first_line()
	if row < 0 or row >= terminal_rows then
		return -1
	end
	return row
end

local mark_cell_range_dirty<const> = function(row, first_column, last_column)
	local row_bit<const> = 1 << row
	local first_columns<const>: *word = terminal_dirty_first_columns
	local last_columns<const>: *word = terminal_dirty_last_columns
	if (*terminal_dirty_rows & row_bit) == 0 then
		*terminal_dirty_rows = *terminal_dirty_rows | row_bit
		first_columns[row] = first_column
		last_columns[row] = last_column
		return
	end
	if first_column < first_columns[row] then
		first_columns[row] = first_column
	end
	if last_column > last_columns[row] then
		last_columns[row] = last_column
	end
end

local mark_line_range_dirty<const> = function(line, first_column, last_column)
	local row<const> = screen_row_for_line(line)
	if row >= 0 then
		mark_cell_range_dirty(row, first_column, last_column)
	end
end

local mark_screen_dirty<const> = function()
	local first_columns<const>: *word = terminal_dirty_first_columns
	local last_columns<const>: *word = terminal_dirty_last_columns
	*terminal_dirty_rows = all_rows_dirty
	*terminal_scroll_rows = 0
	for row = 0, terminal_rows - 1 do
		first_columns[row] = 0
		last_columns[row] = terminal_columns
	end
end

local set_cell<const> = function(line, column, word)
	local cells<const>: *word = terminal_cells
	local index<const> = buffer_row_for_line(line) * terminal_columns + column
	if cells[index] ~= word then
		cells[index] = word
		mark_line_range_dirty(line, column, column + 1)
	end
end

local clear_line<const> = function(line)
	local cells<const>: *word = terminal_cells
	local offset<const> = buffer_row_for_line(line) * terminal_columns
	for column = 0, terminal_columns - 1 do
		cells[offset + column] = 0
	end
	mark_line_range_dirty(line, 0, terminal_columns)
end

local shift_dirty_rows_up<const> = function()
	if *terminal_dirty_rows == all_rows_dirty then
		return
	end
	local first_columns<const>: *word = terminal_dirty_first_columns
	local last_columns<const>: *word = terminal_dirty_last_columns
	*terminal_dirty_rows = *terminal_dirty_rows >> 1
	for row = 0, terminal_rows - 2 do
		first_columns[row] = first_columns[row + 1]
		last_columns[row] = last_columns[row + 1]
	end
end

local mark_cursor_dirty<const> = function()
	if *terminal_cursor_visible == 0 or *terminal_status_visible ~= 0 or *terminal_cursor_column >= terminal_columns then
		return
	end
	local row<const> = screen_row_for_line(*terminal_cursor_line)
	if row >= 0 then
		mark_cell_range_dirty(row, *terminal_cursor_column, *terminal_cursor_column + 1)
	end
end

local line_feed<const> = function()
	mark_cursor_dirty()
	*terminal_cursor_column = 0
	if *terminal_cursor_line + 1 < *terminal_line_count then
		*terminal_cursor_line = *terminal_cursor_line + 1
		clear_line(*terminal_cursor_line)
		mark_cursor_dirty()
		return
	end

	if *terminal_line_count < scrollback_rows then
		*terminal_cursor_line = *terminal_cursor_line + 1
		*terminal_line_count = *terminal_line_count + 1
	else
		*terminal_first_buffer_row = (*terminal_first_buffer_row + 1) % scrollback_rows
	end

	if *terminal_view_offset == 0 then
		shift_dirty_rows_up()
		*terminal_scroll_rows = *terminal_scroll_rows + 1
		if *terminal_scroll_rows == terminal_rows then
			mark_screen_dirty()
		end
	else
		local maximum_view_offset<const> = *terminal_line_count - terminal_rows
		if *terminal_view_offset < maximum_view_offset then
			*terminal_view_offset = *terminal_view_offset + 1
		end
		mark_screen_dirty()
	end
	clear_line(*terminal_cursor_line)
	mark_cursor_dirty()
end

local reset_screen<const> = function()
	local cells<const>: *word = terminal_cells
	for index = 0, terminal_columns * terminal_rows - 1 do
		cells[index] = 0
	end
	*terminal_dirty_rows = 0
	*terminal_first_buffer_row = 0
	*terminal_line_count = terminal_rows
	*terminal_cursor_line = 0
	*terminal_cursor_column = 0
	*terminal_cursor_visible = 0
	*terminal_view_offset = 0
	*terminal_scroll_rows = 0
	*terminal_status_visible = 0
	*terminal_input_drawn_length = 0
end

function terminal.open()
	reset_screen()
	local palette<const>: *word = terminal_palette
	palette[0] = terminal_background_word
	palette[1] = 0x00808080
	palette[2] = 0x00303080
	palette[3] = 0x00208080
	mark_screen_dirty()
end

function terminal.clear()
	reset_screen()
	mark_screen_dirty()
end

function terminal.put(row, column, code, palette)
	set_cell(visible_first_line() + row, column, code | (palette << 8))
end

function terminal.write_at(row, column, text, palette)
	local line<const> = visible_first_line() + row
	for index = 1, #text do
		set_cell(line, column + index - 1, byte(text, index) | (palette << 8))
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
	set_cell(*terminal_cursor_line, *terminal_cursor_column, code | (palette << 8))
	*terminal_cursor_column = *terminal_cursor_column + 1
	mark_cursor_dirty()
end

function terminal.write(text, palette)
	for index = 1, #text do
		terminal.write_code(byte(text, index), palette)
	end
end

function terminal.begin_input()
	*terminal_input_line = *terminal_cursor_line
	*terminal_input_column = *terminal_cursor_column
	*terminal_input_drawn_length = 0
end

function terminal.render_input(line, length, cursor, palette)
	terminal.follow_output()
	mark_cursor_dirty()
	local source<const>: *word = line
	local drawn_length<const> = *terminal_input_drawn_length
	local redraw_length = length
	if drawn_length > redraw_length then
		redraw_length = drawn_length
	end
	for index = 0, redraw_length - 1 do
		local cell = 0
		if index < length then
			cell = source[index] | (palette << 8)
		end
		set_cell(*terminal_input_line, *terminal_input_column + index, cell)
	end
	*terminal_input_drawn_length = length
	*terminal_cursor_line = *terminal_input_line
	*terminal_cursor_column = *terminal_input_column + cursor
	mark_cursor_dirty()
end

function terminal.end_input()
	mark_cursor_dirty()
	*terminal_cursor_line = *terminal_input_line
	*terminal_cursor_column = *terminal_input_column + *terminal_input_drawn_length
	mark_cursor_dirty()
end

function terminal.append_row(row)
	local source<const>: *word = row
	local cells<const>: *word = terminal_cells
	local offset<const> = buffer_row_for_line(*terminal_cursor_line) * terminal_columns
	for column = 0, terminal_columns - 1 do
		cells[offset + column] = source[column]
	end
	mark_line_range_dirty(*terminal_cursor_line, 0, terminal_columns)
	line_feed()
end

function terminal.show_status(text, palette)
	local status<const>: *word = terminal_status_cells
	for column = 0, terminal_columns - 1 do
		status[column] = 0
	end
	for index = 1, #text do
		status[index - 1] = byte(text, index) | (palette << 8)
	end
	*terminal_status_visible = 1
	mark_cell_range_dirty(terminal_rows - 1, 0, terminal_columns)
end

function terminal.show_status_row(row)
	local source<const>: *word = row
	local status<const>: *word = terminal_status_cells
	for column = 0, terminal_columns - 1 do
		status[column] = source[column]
	end
	*terminal_status_visible = 1
	mark_cell_range_dirty(terminal_rows - 1, 0, terminal_columns)
end

function terminal.clear_status()
	if *terminal_status_visible ~= 0 then
		*terminal_status_visible = 0
		mark_cell_range_dirty(terminal_rows - 1, 0, terminal_columns)
	end
end

function terminal.scroll_view(lines)
	local maximum_view_offset<const> = *terminal_line_count - terminal_rows
	local next_offset = *terminal_view_offset + lines
	if next_offset < 0 then
		next_offset = 0
	elseif next_offset > maximum_view_offset then
		next_offset = maximum_view_offset
	end
	if next_offset == *terminal_view_offset then
		return false
	end
	*terminal_view_offset = next_offset
	mark_screen_dirty()
	return true
end

function terminal.follow_output()
	if *terminal_view_offset ~= 0 then
		*terminal_view_offset = 0
		mark_screen_dirty()
	end
end

function terminal.show_cursor()
	if *terminal_cursor_visible == 0 then
		*terminal_cursor_visible = 1
		mark_cursor_dirty()
	end
end

function terminal.hide_cursor()
	if *terminal_cursor_visible ~= 0 then
		mark_cursor_dirty()
		*terminal_cursor_visible = 0
	end
end

function terminal.flush()
	local dirty_rows<const> = *terminal_dirty_rows
	if dirty_rows == 0 then
		return
	end
	local cells<const>: *word = terminal_cells
	local status<const>: *word = terminal_status_cells
	local palette<const>: *word = terminal_palette
	local first_columns<const>: *word = terminal_dirty_first_columns
	local last_columns<const>: *word = terminal_dirty_last_columns
	local command_words<const>: *word = terminal_command_words
	local command_word_count = 0
	if dirty_rows == all_rows_dirty then
		command_word_count = gx_gpu.encode_fill_rectangle(command_words, command_word_count, 0, 0, terminal_width, terminal_height, terminal_background_word)
	elseif *terminal_scroll_rows ~= 0 then
		local scroll_pixels<const> = *terminal_scroll_rows * glyph_height
		command_word_count = gx_gpu.encode_vram_copy(command_words, command_word_count, 0, scroll_pixels, 0, 0, terminal_width, terminal_height - scroll_pixels)
		command_word_count = gx_gpu.encode_fill_rectangle(command_words, command_word_count, 0, terminal_height - scroll_pixels, terminal_width, scroll_pixels, terminal_background_word)
	end
	command_word_count = gx_gpu.encode_direct16_texture_page(command_words, command_word_count, terminal_glyphs[0x20] & 0xffff, terminal_glyphs[0x20] >> 16)
	local cursor_row = -1
	if *terminal_cursor_visible ~= 0 and *terminal_status_visible == 0 and *terminal_cursor_column < terminal_columns then
		cursor_row = screen_row_for_line(*terminal_cursor_line)
	end
	for row = 0, terminal_rows - 1 do
		if (dirty_rows & (1 << row)) ~= 0 then
			local first_column<const> = first_columns[row]
			local last_column<const> = last_columns[row]
			local target_y<const> = row * glyph_height
			if dirty_rows ~= all_rows_dirty then
				command_word_count = gx_gpu.encode_rectangle(command_words, command_word_count, first_column * glyph_width, target_y, (last_column - first_column) * glyph_width, glyph_height, terminal_background_word)
			end
			local row_cells: *word = cells
			local source = buffer_row_for_screen(row) * terminal_columns
			if *terminal_status_visible ~= 0 and row == terminal_rows - 1 then
				row_cells = status
				source = 0
			end
			for column = first_column, last_column - 1 do
				local cell = row_cells[source + column]
				if row == cursor_row and column == *terminal_cursor_column then
					cell = cursor_cell
				end
				local code<const> = cell & 0xff
				if code ~= 0 and code ~= 0x20 then
					local glyph<const> = terminal_glyphs[code]
					command_word_count = gx_gpu.encode_textured_rectangle(
						command_words,
						command_word_count,
						glyph & 0xffff,
						glyph >> 16,
						column * glyph_width,
						target_y,
						glyph_width,
						glyph_height,
						palette[(cell >> 8) & 0x03])
				end
			end
		end
	end
	-- The fixed list is not rebuilt until this call returns: DMA has consumed
	-- every RAM word and the final GP0 IRQ proves the GPU reached the list end.
	gx_command_list.submit(command_words, command_word_count)
	*terminal_dirty_rows = 0
	*terminal_scroll_rows = 0
end

return terminal
