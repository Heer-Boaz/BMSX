local assets<const> = require('bmsx/system_assets')
local dma_transfer<const> = require('kernel/dma')
local gx_gpu<const> = require('gpu/gpu')
local gx_commandlist<const> = require('gpu/commandlist')
local layout<const> = require('tty/layout')

local byte<const> = __bmsx_string_byte
local terminal<const> = {}

local terminal_glyphs<const>: *word = assets.bin_bios_terminal_glyphs_addr

local glyph_width<const> = layout.cell_width
local glyph_height<const> = layout.cell_height
local terminal_column_capacity<const> = layout.columns
local terminal_row_capacity<const> = layout.rows
local terminal_buffer_row_capacity<const> = layout.buffer_rows
local terminal_vram_x<const> = layout.vram_x
local terminal_vram_y<const> = layout.vram_y
local terminal_palette_row_words<const> = terminal_column_capacity >> 4
local command_batch_rows<const> = 4
-- Worst-case row capacity combines one clear, one continuous background and
-- one textured rectangle per cell; eight words cover shared state/cursor/IRQ.
local command_batch_words<const> = command_batch_rows * (terminal_column_capacity * 4 + 6) + 8
local ascii_newline<const> = 10
local terminal_background_word<const> = 0x00000000
local terminal_cursor_word<const> = 0x00ffffff
local palette_cell_lsb_mask<const> = 0x55555555
local palette_text<const> = 0
local palette_error<const> = 1
local palette_accent<const> = 2
local palette_ghost<const> = 3

terminal.columns = terminal_column_capacity
terminal.rows = terminal_row_capacity
terminal.page_rows = terminal_row_capacity - 1
terminal.palette_text = palette_text
terminal.palette_error = palette_error
terminal.palette_accent = palette_accent
terminal.palette_ghost = palette_ghost

rodata terminal_palette_words: word[4] = {
	0x00808080,
	0x00303080,
	0x00208080,
	0x00404040,
}

bss terminal_cell_codes: u8[terminal_buffer_row_capacity * terminal_column_capacity]
bss terminal_cell_palettes: word[terminal_buffer_row_capacity * terminal_palette_row_words]
bss terminal_status_codes: u8[terminal_column_capacity]
bss terminal_status_palettes: word[terminal_palette_row_words]
bss terminal_dirty_first_columns: u8[terminal_row_capacity]
bss terminal_dirty_last_columns: u8[terminal_row_capacity]
bss terminal_dirty_rows: word[2]
bss terminal_full_dirty_rows: word[2]
bss terminal_active_columns: word
bss terminal_active_rows: word
bss terminal_active_width: word
bss terminal_active_height: word
bss terminal_line_capacity: word
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
bss terminal_input_length: word
bss terminal_input_rendered_length: word
bss terminal_command_words: word[command_batch_words]

local visible_first_line<const> = function()
	return *terminal_line_count - *terminal_active_rows - *terminal_view_offset
end

local buffer_row_for_line<const> = function(line)
	return (*terminal_first_buffer_row + line) % terminal_buffer_row_capacity
end

local buffer_row_for_screen<const> = function(row)
	return buffer_row_for_line(visible_first_line() + row)
end

local screen_row_for_line<const> = function(line)
	local row<const> = line - visible_first_line()
	if row < 0 or row >= *terminal_active_rows then
		return -1
	end
	return row
end

local mark_cell_range_dirty<const> = function(row, first_column, last_column)
	local dirty_rows<const>: *word = terminal_dirty_rows
	local dirty_word_index<const> = row >> 5
	local row_bit<const> = 1 << (row & 31)
	local first_columns<const>: *u8 = terminal_dirty_first_columns
	local last_columns<const>: *u8 = terminal_dirty_last_columns
	if (dirty_rows[dirty_word_index] & row_bit) == 0 then
		dirty_rows[dirty_word_index] = dirty_rows[dirty_word_index] | row_bit
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
	local dirty_rows<const>: *word = terminal_dirty_rows
	local full_dirty_rows<const>: *word = terminal_full_dirty_rows
	local first_columns<const>: *u8 = terminal_dirty_first_columns
	local last_columns<const>: *u8 = terminal_dirty_last_columns
	dirty_rows[0] = full_dirty_rows[0]
	dirty_rows[1] = full_dirty_rows[1]
	*terminal_scroll_rows = 0
	for row = 0, *terminal_active_rows - 1 do
		first_columns[row] = 0
		last_columns[row] = *terminal_active_columns
	end
end

local set_cell<const> = function(line, column, code, palette)
	local codes<const>: *u8 = terminal_cell_codes
	local palettes<const>: *word = terminal_cell_palettes
	local index<const> = buffer_row_for_line(line) * terminal_column_capacity + column
	local palette_index<const> = index >> 4
	local palette_shift<const> = (index & 15) << 1
	local palette_word<const> = palettes[palette_index]
	if codes[index] ~= code or ((palette_word >> palette_shift) & 3) ~= palette then
		codes[index] = code
		palettes[palette_index] = (palette_word & ~(3 << palette_shift)) | (palette << palette_shift)
		mark_line_range_dirty(line, column, column + 1)
	end
end

local clear_line<const> = function(line)
	local codes<const>: *u8 = terminal_cell_codes
	local palettes<const>: *word = terminal_cell_palettes
	local buffer_row<const> = buffer_row_for_line(line)
	local offset<const> = buffer_row * terminal_column_capacity
	for column = 0, terminal_column_capacity - 1 do
		codes[offset + column] = 0
	end
	local palette_offset<const> = buffer_row * terminal_palette_row_words
	for index = 0, terminal_palette_row_words - 1 do
		palettes[palette_offset + index] = 0
	end
	mark_line_range_dirty(line, 0, *terminal_active_columns)
end

local shift_dirty_rows_up<const> = function()
	local dirty_rows<const>: *word = terminal_dirty_rows
	local full_dirty_rows<const>: *word = terminal_full_dirty_rows
	if dirty_rows[0] == full_dirty_rows[0] and dirty_rows[1] == full_dirty_rows[1] then
		return
	end
	local first_columns<const>: *u8 = terminal_dirty_first_columns
	local last_columns<const>: *u8 = terminal_dirty_last_columns
	dirty_rows[0] = (dirty_rows[0] >> 1) | (dirty_rows[1] << 31)
	dirty_rows[1] = dirty_rows[1] >> 1
	for row = 0, *terminal_active_rows - 2 do
		first_columns[row] = first_columns[row + 1]
		last_columns[row] = last_columns[row + 1]
	end
end

local mark_cursor_dirty<const> = function()
	if *terminal_cursor_visible == 0 or *terminal_status_visible ~= 0 or *terminal_cursor_column >= *terminal_active_columns then
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

	if *terminal_line_count < *terminal_line_capacity then
		*terminal_cursor_line = *terminal_cursor_line + 1
		*terminal_line_count = *terminal_line_count + 1
	else
		*terminal_first_buffer_row = (*terminal_first_buffer_row + 1) % terminal_buffer_row_capacity
	end

	if *terminal_view_offset == 0 then
		shift_dirty_rows_up()
		*terminal_scroll_rows = *terminal_scroll_rows + 1
		if *terminal_scroll_rows == *terminal_active_rows then
			mark_screen_dirty()
		end
	else
		local maximum_view_offset<const> = *terminal_line_count - *terminal_active_rows
		if *terminal_view_offset < maximum_view_offset then
			*terminal_view_offset = *terminal_view_offset + 1
		end
		mark_screen_dirty()
	end
	clear_line(*terminal_cursor_line)
	mark_cursor_dirty()
end

local reset_screen<const> = function()
	local codes<const>: *u8 = terminal_cell_codes
	local palettes<const>: *word = terminal_cell_palettes
	local dirty_rows<const>: *word = terminal_dirty_rows
	for index = 0, terminal_column_capacity * terminal_row_capacity - 1 do
		codes[index] = 0
	end
	for index = 0, terminal_palette_row_words * terminal_row_capacity - 1 do
		palettes[index] = 0
	end
	dirty_rows[0] = 0
	dirty_rows[1] = 0
	*terminal_first_buffer_row = 0
	*terminal_line_count = *terminal_active_rows
	*terminal_cursor_line = 0
	*terminal_cursor_column = 0
	*terminal_cursor_visible = 0
	*terminal_view_offset = 0
	*terminal_scroll_rows = 0
	*terminal_status_visible = 0
	*terminal_input_length = 0
	*terminal_input_rendered_length = 0
end

function terminal.open(width, height)
	local active_width<const> = width < layout.width and width or layout.width
	local active_height<const> = height < layout.height and height or layout.height
	local columns<const> = (active_width + glyph_width - 1) // glyph_width
	local rows<const> = (active_height + glyph_height - 1) // glyph_height
	*terminal_active_columns = columns < terminal_column_capacity and columns or terminal_column_capacity
	*terminal_active_rows = rows < terminal_row_capacity and rows or terminal_row_capacity
	*terminal_active_width = active_width
	*terminal_active_height = active_height
	*terminal_line_capacity = *terminal_active_rows + layout.scrollback_rows
	local full_dirty_rows<const>: *word = terminal_full_dirty_rows
	if *terminal_active_rows < 32 then
		full_dirty_rows[0] = (1 << *terminal_active_rows) - 1
		full_dirty_rows[1] = 0
	else
		full_dirty_rows[0] = 0xffffffff
		full_dirty_rows[1] = (1 << (*terminal_active_rows - 32)) - 1
	end
	terminal.columns = *terminal_active_columns
	terminal.rows = *terminal_active_rows
	terminal.page_rows = *terminal_active_rows - 1
	reset_screen()
	mark_screen_dirty()
end

function terminal.clear()
	reset_screen()
	mark_screen_dirty()
end

function terminal.put(row, column, code, palette)
	set_cell(visible_first_line() + row, column, code, palette)
end

function terminal.write_at(row, column, text, palette)
	local line<const> = visible_first_line() + row
	for index = 1, #text do
		set_cell(line, column + index - 1, byte(text, index), palette)
	end
end

function terminal.write_code(code, palette)
	if code == ascii_newline then
		line_feed()
		return
	end
	if *terminal_cursor_column == *terminal_active_columns then
		line_feed()
	end
	mark_cursor_dirty()
	set_cell(*terminal_cursor_line, *terminal_cursor_column, code, palette)
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
	*terminal_input_length = 0
	*terminal_input_rendered_length = 0
end

function terminal.render_input(line, length, cursor, palette, completion, completion_start, completion_palette)
	terminal.follow_output()
	mark_cursor_dirty()
	local source<const>: *u8 = line
	local completion_length<const> = #completion - completion_start
	local rendered_length<const> = length + completion_length
	local redraw_length = rendered_length
	if *terminal_input_rendered_length > redraw_length then
		redraw_length = *terminal_input_rendered_length
	end
	for index = 0, redraw_length - 1 do
		local code = 0
		local cell_palette = palette_text
		if index < length then
			code = source[index]
			cell_palette = palette
		elseif index < rendered_length then
			code = byte(completion, completion_start + index - length + 1)
			cell_palette = completion_palette
		end
		set_cell(*terminal_input_line, *terminal_input_column + index, code, cell_palette)
	end
	*terminal_input_length = length
	*terminal_input_rendered_length = rendered_length
	*terminal_cursor_line = *terminal_input_line
	*terminal_cursor_column = *terminal_input_column + cursor
	mark_cursor_dirty()
end

function terminal.end_input()
	mark_cursor_dirty()
	for index = *terminal_input_length, *terminal_input_rendered_length - 1 do
		set_cell(*terminal_input_line, *terminal_input_column + index, 0, palette_text)
	end
	*terminal_input_rendered_length = *terminal_input_length
	*terminal_cursor_line = *terminal_input_line
	*terminal_cursor_column = *terminal_input_column + *terminal_input_length
	mark_cursor_dirty()
end

function terminal.append_row(row)
	local source<const>: *u16 = row
	local codes<const>: *u8 = terminal_cell_codes
	local palettes<const>: *word = terminal_cell_palettes
	local buffer_row<const> = buffer_row_for_line(*terminal_cursor_line)
	local offset<const> = buffer_row * terminal_column_capacity
	local palette_offset<const> = buffer_row * terminal_palette_row_words
	for index = 0, terminal_palette_row_words - 1 do
		local column<const> = index << 4
		local packed = 0
		for cell = 0, 15 do
			local value<const> = source[column + cell]
			codes[offset + column + cell] = value
			packed = packed | (((value >> 8) & 3) << (cell << 1))
		end
		palettes[palette_offset + index] = packed
	end
	mark_line_range_dirty(*terminal_cursor_line, 0, *terminal_active_columns)
	line_feed()
end

function terminal.show_status(text, palette)
	local codes<const>: *u8 = terminal_status_codes
	local palettes<const>: *word = terminal_status_palettes
	for column = 0, terminal_column_capacity - 1 do
		codes[column] = 0
	end
	local palette_word<const> = palette * palette_cell_lsb_mask
	for index = 0, terminal_palette_row_words - 1 do
		palettes[index] = palette_word
	end
	local length = #text
	if length > *terminal_active_columns then
		length = *terminal_active_columns
	end
	for index = 1, length do
		codes[index - 1] = byte(text, index)
	end
	*terminal_status_visible = 1
	mark_cell_range_dirty(*terminal_active_rows - 1, 0, *terminal_active_columns)
end

function terminal.put_status(column, code, palette)
	local codes<const>: *u8 = terminal_status_codes
	local palettes<const>: *word = terminal_status_palettes
	local palette_index<const> = column >> 4
	local palette_shift<const> = (column & 15) << 1
	local palette_word<const> = palettes[palette_index]
	if *terminal_status_visible ~= 0
		and codes[column] == code
		and ((palette_word >> palette_shift) & 3) == palette then
		return
	end
	codes[column] = code
	palettes[palette_index] = (palette_word & ~(3 << palette_shift)) | (palette << palette_shift)
	*terminal_status_visible = 1
	mark_cell_range_dirty(*terminal_active_rows - 1, column, column + 1)
end

function terminal.show_status_row(row)
	local source<const>: *u16 = row
	local codes<const>: *u8 = terminal_status_codes
	local palettes<const>: *word = terminal_status_palettes
	for index = 0, terminal_palette_row_words - 1 do
		local column<const> = index << 4
		local packed = 0
		for cell = 0, 15 do
			local value<const> = source[column + cell]
			codes[column + cell] = value
			packed = packed | (((value >> 8) & 3) << (cell << 1))
		end
		palettes[index] = packed
	end
	*terminal_status_visible = 1
	mark_cell_range_dirty(*terminal_active_rows - 1, 0, *terminal_active_columns)
end

function terminal.clear_status()
	if *terminal_status_visible ~= 0 then
		*terminal_status_visible = 0
		mark_cell_range_dirty(*terminal_active_rows - 1, 0, *terminal_active_columns)
	end
end

function terminal.scroll_view(lines)
	local maximum_view_offset<const> = *terminal_line_count - *terminal_active_rows
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
	local dirty_rows<const>: *word = terminal_dirty_rows
	if (dirty_rows[0] | dirty_rows[1]) == 0 then
		return
	end
	local full_dirty_rows<const>: *word = terminal_full_dirty_rows
	local full_redraw<const> = dirty_rows[0] == full_dirty_rows[0] and dirty_rows[1] == full_dirty_rows[1]
	local codes<const>: *u8 = terminal_cell_codes
	local palettes<const>: *word = terminal_cell_palettes
	local status_codes<const>: *u8 = terminal_status_codes
	local status_palettes<const>: *word = terminal_status_palettes
	local palette_words<const>: *word = terminal_palette_words
	local first_columns<const>: *u8 = terminal_dirty_first_columns
	local last_columns<const>: *u8 = terminal_dirty_last_columns
	local command_words<const>: *word = terminal_command_words
	local command_word_count = 0
	if full_redraw then
		command_word_count = gx_gpu.encode_mask_bit_mode(command_words, command_word_count, 0)
		command_word_count = gx_gpu.encode_fill_rectangle(command_words, command_word_count, terminal_vram_x, terminal_vram_y, *terminal_active_width, *terminal_active_height, terminal_background_word)
		dma_transfer.copy_to_gp0(command_words, command_word_count)
	elseif *terminal_scroll_rows ~= 0 then
		command_word_count = gx_gpu.encode_mask_bit_mode(command_words, command_word_count, 0)
		local scroll_pixels<const> = *terminal_scroll_rows * glyph_height
		command_word_count = gx_gpu.encode_vram_copy(command_words, command_word_count, terminal_vram_x, terminal_vram_y + scroll_pixels, terminal_vram_x, terminal_vram_y, *terminal_active_width, *terminal_active_height - scroll_pixels)
		command_word_count = gx_gpu.encode_fill_rectangle(command_words, command_word_count, terminal_vram_x, terminal_vram_y + *terminal_active_height - scroll_pixels, *terminal_active_width, scroll_pixels, terminal_background_word)
		dma_transfer.copy_to_gp0(command_words, command_word_count)
	end
	local cursor_row = -1
	if *terminal_cursor_visible ~= 0 and *terminal_status_visible == 0 and *terminal_cursor_column < *terminal_active_columns then
		cursor_row = screen_row_for_line(*terminal_cursor_line)
	end
	local last_dirty_row = *terminal_active_rows - 1
	while (dirty_rows[last_dirty_row >> 5] & (1 << (last_dirty_row & 31))) == 0 do
		last_dirty_row = last_dirty_row - 1
	end
	local first_batch_row = 0
	while first_batch_row <= last_dirty_row do
		local last_batch_row = first_batch_row + command_batch_rows
		if last_batch_row > *terminal_active_rows then
			last_batch_row = *terminal_active_rows
		end
		local first_dirty_row = first_batch_row
		while first_dirty_row < last_batch_row and (dirty_rows[first_dirty_row >> 5] & (1 << (first_dirty_row & 31))) == 0 do
			first_dirty_row = first_dirty_row + 1
		end
		if first_dirty_row < last_batch_row then
			command_word_count = gx_gpu.encode_mask_bit_mode(command_words, 0, 0)
			if not full_redraw then
				for row = first_dirty_row, last_batch_row - 1 do
					if (dirty_rows[row >> 5] & (1 << (row & 31))) ~= 0 then
						local first_column<const> = first_columns[row]
						command_word_count = gx_gpu.encode_rectangle(command_words, command_word_count, first_column * glyph_width, row * glyph_height, (last_columns[row] - first_column) * glyph_width, glyph_height, terminal_background_word)
					end
				end
			end
			command_word_count = gx_gpu.encode_mask_bit_mode(command_words, command_word_count, 1)
			command_word_count = gx_gpu.encode_direct16_texture_page(command_words, command_word_count, terminal_glyphs[0x20] & 0xffff, terminal_glyphs[0x20] >> 16)
			for row = first_dirty_row, last_batch_row - 1 do
				if (dirty_rows[row >> 5] & (1 << (row & 31))) ~= 0 then
					local first_column<const> = first_columns[row]
					local last_column<const> = last_columns[row]
					local target_y<const> = row * glyph_height
					local row_codes: *u8 = codes
					local row_palettes: *word = palettes
					local source = buffer_row_for_screen(row) * terminal_column_capacity
					if *terminal_status_visible ~= 0 and row == *terminal_active_rows - 1 then
						row_codes = status_codes
						row_palettes = status_palettes
						source = 0
					end
					local background_first_column = -1
					for column = first_column, last_column - 1 do
						if row_codes[source + column] ~= 0 then
							if background_first_column < 0 then
								background_first_column = column
							end
						elseif background_first_column >= 0 then
							command_word_count = gx_gpu.encode_rectangle(command_words, command_word_count, background_first_column * glyph_width, target_y, (column - background_first_column) * glyph_width, glyph_height, terminal_background_word)
							background_first_column = -1
						end
					end
					if background_first_column >= 0 then
						command_word_count = gx_gpu.encode_rectangle(command_words, command_word_count, background_first_column * glyph_width, target_y, (last_column - background_first_column) * glyph_width, glyph_height, terminal_background_word)
					end
					if row == cursor_row and *terminal_cursor_column >= first_column and *terminal_cursor_column < last_column then
						command_word_count = gx_gpu.encode_rectangle(
							command_words,
							command_word_count,
							*terminal_cursor_column * glyph_width,
							target_y,
							glyph_width,
							glyph_height,
							terminal_cursor_word)
					end
					local palette_index = -1
					local palette_word = 0
					for column = first_column, last_column - 1 do
						local cell_index<const> = source + column
						local code<const> = row_codes[cell_index]
						if code ~= 0 and code ~= 0x20 then
							local glyph<const> = terminal_glyphs[code]
							local cell_palette_index<const> = cell_index >> 4
							if cell_palette_index ~= palette_index then
								palette_index = cell_palette_index
								palette_word = row_palettes[cell_palette_index]
							end
							local color = palette_words[(palette_word >> ((cell_index & 15) << 1)) & 3]
							if row == cursor_row and column == *terminal_cursor_column then
								color = terminal_background_word
							end
							command_word_count = gx_gpu.encode_textured_rectangle(
								command_words,
								command_word_count,
								glyph & 0xffff,
								glyph >> 16,
								column * glyph_width,
								target_y,
								glyph_width,
								glyph_height,
								color)
						end
					end
				end
			end
			command_word_count = gx_gpu.encode_mask_bit_mode(command_words, command_word_count, 0)
			if last_dirty_row < last_batch_row then
				gx_commandlist.submit(command_words, command_word_count)
			else
				dma_transfer.copy_to_gp0(command_words, command_word_count)
			end
		end
		first_batch_row = last_batch_row
	end
	dirty_rows[0] = 0
	dirty_rows[1] = 0
	*terminal_scroll_rows = 0
end

return terminal
