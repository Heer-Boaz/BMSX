local vdp_firmware = {}

local default_print_color_index = 15
local max_glyph_index = 2147483647
local white_color = { r = 1, g = 1, b = 1, a = 1 }
local layer_by_name = {
	world = sys_vdp_layer_world,
	ui = sys_vdp_layer_ui,
	ide = sys_vdp_layer_ide,
}
local text_cursor_x
local text_cursor_y
local text_cursor_home_x
local text_cursor_color_index

local function alloc_io_payload(words)
	local write_ptr = peek(sys_vdp_payload_write_ptr)
	local next_ptr = write_ptr + words
	if next_ptr > sys_vdp_payload_capacity then
		error('[vdp_firmware] IO payload buffer overflow (' .. next_ptr .. ' > ' .. sys_vdp_payload_capacity .. ').')
	end
	poke(sys_vdp_payload_write_ptr, next_ptr)
	return write_ptr
end

local function reset_print_cursor()
	text_cursor_home_x = 0
	text_cursor_x = 0
	text_cursor_y = 0
	text_cursor_color_index = default_print_color_index
end

local function advance_print_cursor(line_height)
	text_cursor_y = text_cursor_y + line_height
	local limit = display_height() - line_height
	if text_cursor_y >= limit then
		text_cursor_y = 0
	end
end

local function expand_tabs(text)
	local result = ''
	for index = 1, #text do
		local char = text:sub(index, index)
		if char == '\t' then
			result = result .. '  '
		else
			result = result .. char
		end
	end
	return result
end

local function split_lines(text)
	local lines = {}
	local start_index = 1
	while true do
		local newline_index = string.find(text, '\n', start_index, true)
		if newline_index == nil then
			lines[#lines + 1] = string.sub(text, start_index)
			return lines
		end
		lines[#lines + 1] = string.sub(text, start_index, newline_index - 1)
		start_index = newline_index + 1
	end
end

local function wrap_glyphs(text, max_line_length)
	local words = {}
	local index = 1
	while index <= #text do
		local char = text:sub(index, index)
		if char == '\n' then
			words[#words + 1] = '\n'
			index = index + 1
		elseif string.match(char, '%s') then
			index = index + 1
		else
			local start_index = index
			while index <= #text do
				local next_char = text:sub(index, index)
				if next_char == '\n' or string.match(next_char, '%s') then
					break
				end
				index = index + 1
			end
			words[#words + 1] = string.sub(text, start_index, index - 1)
		end
	end

	local lines = {}
	local current_line
	for index = 1, #words do
		local word = words[index]
		if word == '\n' then
			if current_line then
				lines[#lines + 1] = current_line
			else
				lines[#lines + 1] = string.sub(word, 1, 0)
			end
			current_line = nil
		elseif not current_line then
			current_line = word
		else
			local tentative = current_line .. ' ' .. word
			if #tentative <= max_line_length then
				current_line = tentative
			else
				lines[#lines + 1] = current_line
				current_line = word
			end
		end
	end
	if current_line then
		lines[#lines + 1] = current_line
	end
	return lines
end

local function calculate_centered_block_x(lines, font, block_width)
	local longest_line = ''
	for index = 1, #lines do
		local line = lines[index]
		if #line > #longest_line then
			longest_line = line
		end
	end
	local char_width = font.glyphs['a'].width
	return (block_width - (#longest_line * char_width)) / 2
end

local function submit_clear(color_value)
	poke_words(sys_vdp_cmd_arg0, color_value.r, color_value.g, color_value.b, color_value.a)
	poke(sys_vdp_cmd, sys_vdp_cmd_clear)
end

local function submit_fill_rect(x0, y0, x1, y1, z, layer, color_value)
	poke_words(sys_vdp_cmd_arg0, x0, y0, x1, y1, z, layer, color_value.r, color_value.g, color_value.b, color_value.a)
	poke(sys_vdp_cmd, sys_vdp_cmd_fill_rect)
end

local function submit_draw_line(x0, y0, x1, y1, z, layer, color_value, thickness)
	poke_words(sys_vdp_cmd_arg0, x0, y0, x1, y1, z, layer, color_value.r, color_value.g, color_value.b, color_value.a, thickness)
	poke(sys_vdp_cmd, sys_vdp_cmd_draw_line)
end

local function submit_blit(handle, x, y, z, layer, scale_x, scale_y, flip_h, flip_v, color_value, parallax_weight)
	poke_words(sys_vdp_cmd_arg0, handle, x, y, z, layer, scale_x, scale_y, (flip_h and 1 or 0) | (flip_v and 2 or 0), color_value.r, color_value.g, color_value.b, color_value.a, parallax_weight)
	poke(sys_vdp_cmd, sys_vdp_cmd_blit)
end

local function submit_glyph_line(text, x, y, z, font, color_value, background_color, start_index, end_index, layer)
	if #text == 0 then
		return
	end
	local payload_words = math.floor((#text + 3) / 4)
	local payload_offset = alloc_io_payload(payload_words)
	for word_index = 0, payload_words - 1 do
		local byte_index = word_index * 4 + 1
		local word =
			(string.byte(text, byte_index) or 0)
			| ((string.byte(text, byte_index + 1) or 0) << 8)
			| ((string.byte(text, byte_index + 2) or 0) << 16)
			| ((string.byte(text, byte_index + 3) or 0) << 24)
		poke(sys_vdp_payload_buffer_base + (payload_offset + word_index) * sys_vdp_arg_stride, word)
	end
	if background_color ~= nil then
		poke_words(sys_vdp_cmd_arg0, payload_offset, #text, x, y, z, font.id, start_index, end_index, layer, color_value.r, color_value.g, color_value.b, color_value.a, 1, background_color.r, background_color.g, background_color.b, background_color.a)
		poke(sys_vdp_cmd, sys_vdp_cmd_glyph_run)
		return
	end
	poke_words(sys_vdp_cmd_arg0, payload_offset, #text, x, y, z, font.id, start_index, end_index, layer, color_value.r, color_value.g, color_value.b, color_value.a, 0)
	poke(sys_vdp_cmd, sys_vdp_cmd_glyph_run)
end

function dma_blit_tiles(desc)
	local tile_count = desc.cols * desc.rows
	local payload_offset = alloc_io_payload(tile_count)
	for index = 1, tile_count do
		local tile = desc.tiles[index]
		if tile == nil then
			error('[vdp_firmware] dma_blit_tiles missing tile at index ' .. (index - 1) .. '.')
		end
		local handle = assets.img[tile].handle
		poke(sys_vdp_payload_buffer_base + (payload_offset + index - 1) * sys_vdp_arg_stride, handle)
	end
	local layer = sys_vdp_layer_world
	if desc.layer ~= nil then
		layer = layer_by_name[desc.layer] or desc.layer
	end
	poke_words(sys_vdp_cmd_arg0, payload_offset, tile_count, desc.cols, desc.rows, desc.tile_w, desc.tile_h, desc.origin_x, desc.origin_y, desc.scroll_x, desc.scroll_y, desc.z, layer)
	poke(sys_vdp_cmd, sys_vdp_cmd_tile_run)
end

local function draw_multiline_text(text, x, y, z, color_value, font)
	local lines = split_lines(text)
	local cursor_y = y
	for index = 1, #lines do
		local expanded = expand_tabs(lines[index])
		if #expanded > 0 then
			submit_glyph_line(expanded, x, cursor_y, z, font, color_value, nil, 0, max_glyph_index, sys_vdp_layer_world)
		end
		if index < #lines then
			cursor_y = cursor_y + font.line_height
		end
	end
	text_cursor_x = text_cursor_home_x
	text_cursor_y = cursor_y
	return cursor_y
end

function cls(colorindex)
	submit_clear(sys_palette_color(colorindex or 0))
	reset_print_cursor()
end

function blit_rect(x0, y0, x1, y1, z, colorindex)
	local color_value = sys_palette_color(colorindex)
	submit_draw_line(x0, y0, x1, y0, z, sys_vdp_layer_world, color_value, 1)
	submit_draw_line(x0, y1, x1, y1, z, sys_vdp_layer_world, color_value, 1)
	submit_draw_line(x0, y0, x0, y1, z, sys_vdp_layer_world, color_value, 1)
	submit_draw_line(x1, y0, x1, y1, z, sys_vdp_layer_world, color_value, 1)
end

function fill_rect(x0, y0, x1, y1, z, colorindex)
	submit_fill_rect(x0, y0, x1, y1, z, sys_vdp_layer_world, sys_palette_color(colorindex))
end

function fill_rect_color(x0, y0, x1, y1, z, color_value, options)
	local layer = sys_vdp_layer_world
	if options ~= nil and options.layer ~= nil then
		layer = layer_by_name[options.layer] or options.layer
	end
	if type(color_value) == 'number' then
		color_value = sys_palette_color(color_value)
	end
	submit_fill_rect(x0, y0, x1, y1, z, layer, color_value)
end

function blit(img_id, x, y, z, options)
	local scale_x = 1
	local scale_y = 1
	local flip_h = false
	local flip_v = false
	local color_value = white_color
	local parallax_weight = 0
	local layer = sys_vdp_layer_world
	if options ~= nil then
		if options.scale ~= nil then
			if type(options.scale) == 'number' then
				scale_x = options.scale
				scale_y = options.scale
			else
				scale_x = options.scale.x
				scale_y = options.scale.y
			end
		end
		flip_h = options.flip_h
		flip_v = options.flip_v
		if options.colorize ~= nil then
			if type(options.colorize) == 'number' then
				color_value = sys_palette_color(options.colorize)
			else
				color_value = options.colorize
			end
		end
		if options.parallax_weight ~= nil then
			parallax_weight = options.parallax_weight
		end
		if options.layer ~= nil then
			layer = layer_by_name[options.layer] or options.layer
		end
	end
	submit_blit(assets.img[img_id].handle, x, y, z, layer, scale_x, scale_y, flip_h, flip_v, color_value, parallax_weight)
end

function blit_glyphs(glyphs, x, y, z, options)
	if options == nil or options.font == nil then
		error('blit_glyphs requires options.font.')
	end
	local glyph_start = options.glyph_start or 0
	local glyph_end = options.glyph_end or max_glyph_index
	local color_value = sys_palette_color(default_print_color_index)
	if options.color ~= nil then
		if type(options.color) == 'number' then
			color_value = sys_palette_color(options.color)
		else
			color_value = options.color
		end
	end
	local background_color
	if options.background_color ~= nil then
		if type(options.background_color) == 'number' then
			background_color = sys_palette_color(options.background_color)
		else
			background_color = options.background_color
		end
	end
	local layer = sys_vdp_layer_world
	if options.layer ~= nil then
		layer = layer_by_name[options.layer] or options.layer
	end
	local lines
	if type(glyphs) == 'string' then
		if options.wrap_chars ~= nil and options.wrap_chars > 0 then
			lines = wrap_glyphs(glyphs, options.wrap_chars)
		else
			lines = { glyphs }
		end
	else
		lines = glyphs
	end
	local draw_x = x
	if options.center_block_width ~= nil and options.center_block_width > 0 then
		draw_x = draw_x + calculate_centered_block_x(lines, options.font, options.center_block_width)
	end
	local cursor_y = y
	local line_height = options.font.line_height
	for index = 1, #lines do
		submit_glyph_line(lines[index], draw_x, cursor_y, z, options.font, color_value, background_color, glyph_start, glyph_end, layer)
		cursor_y = cursor_y + line_height
	end
end

function blit_poly(points, z, color_value, thickness, layer)
	if #points < 4 then
		return
	end
	local resolved_color = color_value
	if type(resolved_color) == 'number' then
		resolved_color = sys_palette_color(resolved_color)
	end
	local resolved_thickness = thickness or 1
	local resolved_layer = sys_vdp_layer_world
	if layer ~= nil then
		resolved_layer = layer_by_name[layer] or layer
	end
	local index = 1
	while index <= #points do
		local next_index = index + 2
		if next_index > #points then
			next_index = 1
		end
		submit_draw_line(points[index], points[index + 1], points[next_index], points[next_index + 1], z, resolved_layer, resolved_color, resolved_thickness)
		index = index + 2
	end
end

function blit_text(text, x, y, z, colorindex, options)
	local render_font = options and options.font or get_default_font()
	local base_x = text_cursor_x
	local base_y = text_cursor_y
	if x ~= nil and y ~= nil then
		text_cursor_home_x = x
		text_cursor_x = x
		text_cursor_y = y
		base_x = text_cursor_x
		base_y = text_cursor_y
	end
	if colorindex ~= nil then
		text_cursor_color_index = colorindex
	end
	local color_value = sys_palette_color(text_cursor_color_index)
	local background_color = nil
	local wrap_chars = nil
	local center_block_width = nil
	local glyph_start = 0
	local glyph_end = max_glyph_index
	local layer = sys_vdp_layer_world
	local should_advance = true
	if options ~= nil then
		if options.color ~= nil then
			if type(options.color) == 'number' then
				color_value = sys_palette_color(options.color)
			else
				color_value = options.color
			end
		end
		if options.background_color ~= nil then
			if type(options.background_color) == 'number' then
				background_color = sys_palette_color(options.background_color)
			else
				background_color = options.background_color
			end
		end
		wrap_chars = options.wrap_chars
		center_block_width = options.center_block_width
		glyph_start = options.glyph_start or glyph_start
		glyph_end = options.glyph_end or glyph_end
		if options.layer ~= nil then
			layer = layer_by_name[options.layer] or options.layer
		end
		if options.auto_advance ~= nil then
				should_advance = options.auto_advance
			end
	end
	local expanded = expand_tabs(text)
	local lines
	if wrap_chars ~= nil and wrap_chars > 0 then
		lines = wrap_glyphs(expanded, wrap_chars)
	else
		lines = split_lines(expanded)
	end
	local draw_x = base_x
	if center_block_width ~= nil and center_block_width > 0 then
		draw_x = draw_x + calculate_centered_block_x(lines, render_font, center_block_width)
	end
	local line_height = render_font.line_height
	local cursor_y = base_y
	local render_z = z or 0
	for index = 1, #lines do
		submit_glyph_line(lines[index], draw_x, cursor_y, render_z, render_font, color_value, background_color, glyph_start, glyph_end, layer)
		cursor_y = cursor_y + line_height
	end
	if should_advance then
		text_cursor_y = base_y + ((#lines - 1) * line_height)
		advance_print_cursor(line_height)
	end
end

function blit_text_color(text, x, y, z, colorvalue)
	if x ~= nil and y ~= nil then
		text_cursor_home_x = x
		text_cursor_x = x
		text_cursor_y = y
	end
	if type(colorvalue) == 'number' then
		text_cursor_color_index = colorvalue
	end
	local color_value
	if colorvalue ~= nil and type(colorvalue) ~= 'number' then
		color_value = colorvalue
	else
		color_value = sys_palette_color(text_cursor_color_index)
	end
	draw_multiline_text(text, text_cursor_x, text_cursor_y, z or 0, color_value, get_default_font())
	advance_print_cursor(get_default_font().line_height)
end

function blit_text_with_font(text, x, y, z, colorindex, font)
	local render_font = font or get_default_font()
	local base_x = text_cursor_x
	local base_y = text_cursor_y
	if x ~= nil and y ~= nil then
		text_cursor_home_x = x
		text_cursor_x = x
		text_cursor_y = y
		base_x = text_cursor_x
		base_y = text_cursor_y
	end
	if colorindex ~= nil then
		text_cursor_color_index = colorindex
	end
	draw_multiline_text(text, base_x, base_y, z or 0, sys_palette_color(text_cursor_color_index), render_font)
	advance_print_cursor(render_font.line_height)
end

function blit_text_inline_with_font(text, x, y, z, colorindex, font)
	submit_glyph_line(text, x, y, z, font or get_default_font(), sys_palette_color(colorindex), nil, 0, max_glyph_index, sys_vdp_layer_world)
end

function blit_text_inline_span_with_font(text, start_index, end_index, x, y, z, colorindex, font)
	submit_glyph_line(text, x, y, z, font or get_default_font(), sys_palette_color(colorindex), nil, start_index, end_index, sys_vdp_layer_world)
end

reset_print_cursor()

return vdp_firmware
