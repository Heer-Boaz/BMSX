local vdp_firmware = {}

local default_print_color_index = 15
local max_glyph_index = 2147483647
local white_color = { r = 1, g = 1, b = 1, a = 1 }
local text_cursor_x
local text_cursor_y
local text_cursor_home_x
local text_cursor_color_index

local function resolve_layer(layer)
	if layer == nil or layer == 'world' then
		return sys_vdp_layer_world
	end
	if layer == 'ui' then
		return sys_vdp_layer_ui
	end
	if layer == 'ide' then
		return sys_vdp_layer_ide
	end
	return layer
end

local function resolve_color(value)
	if type(value) == 'number' then
		return sys_palette_color(value)
	end
	return value
end

local function resolve_image_handle(id)
	local asset = assets.img[id]
	if asset == nil then
		error('[vdp_firmware] Image asset "' .. tostring(id) .. '" not found.')
	end
	if asset.handle == nil then
		error('[vdp_firmware] Image asset "' .. tostring(id) .. '" has no runtime handle.')
	end
	return asset.handle
end

local function resolve_font_glyph(font, char)
	local glyph = font.glyphs[char]
	if glyph ~= nil then
		return glyph
	end
	glyph = font.glyphs['?']
	if glyph ~= nil then
		return glyph
	end
	error('[vdp_firmware] Font is missing glyph "' .. tostring(char) .. '" and fallback "?".')
end

local function font_char_width(font, char)
	return resolve_font_glyph(font, char).width
end

local function alloc_io_command(opcode)
	local count = peek(sys_io_write_ptr)
	if count >= sys_io_command_capacity then
		error('[vdp_firmware] IO command buffer overflow at opcode ' .. opcode .. '.')
	end
	local base = sys_io_buffer_base + count * sys_io_command_stride
	return base, count + 1
end

local function commit_io_command(next_count)
	poke(sys_io_write_ptr, next_count)
end

local function alloc_io_payload(words)
	local write_ptr = peek(sys_io_payload_write_ptr)
	local next_ptr = write_ptr + words
	if next_ptr > sys_io_payload_capacity then
		error('[vdp_firmware] IO payload buffer overflow (' .. next_ptr .. ' > ' .. sys_io_payload_capacity .. ').')
	end
	poke(sys_io_payload_write_ptr, next_ptr)
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
	local char_width = font_char_width(font, 'a')
	return (block_width - (#longest_line * char_width)) / 2
end

local function queue_clear(color_value)
	local base, next_count = alloc_io_command(sys_io_cmd_vdp_clear)
	poke_words(base, sys_io_cmd_vdp_clear, color_value.r, color_value.g, color_value.b, color_value.a)
	commit_io_command(next_count)
end

local function queue_fill_rect(x0, y0, x1, y1, z, layer, color_value)
	local base, next_count = alloc_io_command(sys_io_cmd_vdp_fill_rect)
	poke_words(base, sys_io_cmd_vdp_fill_rect, x0, y0, x1, y1, z, layer, color_value.r, color_value.g, color_value.b, color_value.a)
	commit_io_command(next_count)
end

local function queue_draw_line(x0, y0, x1, y1, z, layer, color_value, thickness)
	local base, next_count = alloc_io_command(sys_io_cmd_vdp_draw_line)
	poke_words(base, sys_io_cmd_vdp_draw_line, x0, y0, x1, y1, z, layer, color_value.r, color_value.g, color_value.b, color_value.a, thickness)
	commit_io_command(next_count)
end

local function queue_blit(handle, x, y, z, layer, scale_x, scale_y, flip_h, flip_v, color_value, parallax_weight)
	local base, next_count = alloc_io_command(sys_io_cmd_vdp_blit)
	poke_words(base, sys_io_cmd_vdp_blit, handle, x, y, z, layer, scale_x, scale_y, (flip_h and 1 or 0) | (flip_v and 2 or 0), color_value.r, color_value.g, color_value.b, color_value.a, parallax_weight)
	commit_io_command(next_count)
end

local function queue_glyph_line(text, x, y, z, font, color_value, background_color, start_index, end_index, layer)
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
		poke(sys_io_payload_buffer_base + (payload_offset + word_index) * sys_io_arg_stride, word)
	end
	local base, next_count = alloc_io_command(sys_io_cmd_vdp_glyph_run)
	if background_color ~= nil then
		poke_words(base, sys_io_cmd_vdp_glyph_run, payload_offset, #text, x, y, z, font.id, start_index, end_index, layer, color_value.r, color_value.g, color_value.b, color_value.a, 1, background_color.r, background_color.g, background_color.b, background_color.a)
		commit_io_command(next_count)
		return
	end
	poke_words(base, sys_io_cmd_vdp_glyph_run, payload_offset, #text, x, y, z, font.id, start_index, end_index, layer, color_value.r, color_value.g, color_value.b, color_value.a, 0)
	commit_io_command(next_count)
end

function dma_blit_tiles(desc)
	local tile_count = desc.cols * desc.rows
	local payload_offset = alloc_io_payload(tile_count)
	for index = 1, tile_count do
		local tile = desc.tiles[index]
		if tile == nil then
			error('[vdp_firmware] dma_blit_tiles missing tile at index ' .. (index - 1) .. '.')
		end
		local handle = sys_io_vdp_tile_handle_none
		if tile then
			handle = resolve_image_handle(tile)
		end
		poke(sys_io_payload_buffer_base + (payload_offset + index - 1) * sys_io_arg_stride, handle)
	end
	local base, next_count = alloc_io_command(sys_io_cmd_vdp_tile_run)
	poke_words(base, sys_io_cmd_vdp_tile_run, payload_offset, tile_count, desc.cols, desc.rows, desc.tile_w, desc.tile_h, desc.origin_x, desc.origin_y, desc.scroll_x, desc.scroll_y, desc.z, resolve_layer(desc.layer))
	commit_io_command(next_count)
end

local function draw_multiline_text(text, x, y, z, color_value, font)
	local lines = split_lines(text)
	local cursor_y = y
	for index = 1, #lines do
		local expanded = expand_tabs(lines[index])
		if #expanded > 0 then
			queue_glyph_line(expanded, x, cursor_y, z, font, color_value, nil, 0, max_glyph_index, sys_vdp_layer_world)
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
	queue_clear(sys_palette_color(colorindex or 0))
	reset_print_cursor()
end

function blit_rect(x0, y0, x1, y1, z, colorindex)
	local color_value = sys_palette_color(colorindex)
	queue_draw_line(x0, y0, x1, y0, z, sys_vdp_layer_world, color_value, 1)
	queue_draw_line(x0, y1, x1, y1, z, sys_vdp_layer_world, color_value, 1)
	queue_draw_line(x0, y0, x0, y1, z, sys_vdp_layer_world, color_value, 1)
	queue_draw_line(x1, y0, x1, y1, z, sys_vdp_layer_world, color_value, 1)
end

function fill_rect(x0, y0, x1, y1, z, colorindex)
	queue_fill_rect(x0, y0, x1, y1, z, sys_vdp_layer_world, sys_palette_color(colorindex))
end

function fill_rect_color(x0, y0, x1, y1, z, color_value, options)
	local layer = sys_vdp_layer_world
	if options ~= nil and options.layer ~= nil then
		layer = resolve_layer(options.layer)
	end
	queue_fill_rect(x0, y0, x1, y1, z, layer, resolve_color(color_value))
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
			color_value = resolve_color(options.colorize)
		end
		if options.parallax_weight ~= nil then
			parallax_weight = options.parallax_weight
		end
		if options.layer ~= nil then
			layer = resolve_layer(options.layer)
		end
	end
	queue_blit(resolve_image_handle(img_id), x, y, z, layer, scale_x, scale_y, flip_h, flip_v, color_value, parallax_weight)
end

function blit_glyphs(glyphs, x, y, z, options)
	if options == nil or options.font == nil then
		error('blit_glyphs requires options.font.')
	end
	local glyph_start = options.glyph_start or 0
	local glyph_end = options.glyph_end or max_glyph_index
	local color_value = options.color ~= nil and resolve_color(options.color) or sys_palette_color(default_print_color_index)
	local background_color
	if options.background_color ~= nil then
		background_color = resolve_color(options.background_color)
	end
	local layer = resolve_layer(options.layer)
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
		queue_glyph_line(lines[index], draw_x, cursor_y, z, options.font, color_value, background_color, glyph_start, glyph_end, layer)
		cursor_y = cursor_y + line_height
	end
end

function blit_poly(points, z, color_value, thickness, layer)
	if #points < 4 then
		return
	end
	local resolved_color = resolve_color(color_value)
	local resolved_thickness = thickness or 1
	local resolved_layer = resolve_layer(layer)
	local index = 1
	while index <= #points do
		local next_index = index + 2
		if next_index > #points then
			next_index = 1
		end
		queue_draw_line(points[index], points[index + 1], points[next_index], points[next_index + 1], z, resolved_layer, resolved_color, resolved_thickness)
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
			color_value = resolve_color(options.color)
		end
		if options.background_color ~= nil then
			background_color = resolve_color(options.background_color)
		end
		wrap_chars = options.wrap_chars
		center_block_width = options.center_block_width
		glyph_start = options.glyph_start or glyph_start
		glyph_end = options.glyph_end or glyph_end
		if options.layer ~= nil then
			layer = resolve_layer(options.layer)
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
		queue_glyph_line(lines[index], draw_x, cursor_y, render_z, render_font, color_value, background_color, glyph_start, glyph_end, layer)
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
		color_value = resolve_color(colorvalue)
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
	queue_glyph_line(text, x, y, z, font or get_default_font(), sys_palette_color(colorindex), nil, 0, max_glyph_index, sys_vdp_layer_world)
end

function blit_text_inline_span_with_font(text, start_index, end_index, x, y, z, colorindex, font)
	queue_glyph_line(text, x, y, z, font or get_default_font(), sys_palette_color(colorindex), nil, start_index, end_index, sys_vdp_layer_world)
end

reset_print_cursor()

return vdp_firmware
