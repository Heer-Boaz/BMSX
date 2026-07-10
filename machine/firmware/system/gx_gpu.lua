local round_to_nearest<const> = require('bios/util/round_to_nearest')

local gx_gpu<const> = {}

local gp0<const>: *word = 0x0801036c
local gp1<const>: *word = 0x08010370

local gp1_reset<const> = 0x00000000
local gp1_display_enable<const> = 0x03000000
local gp1_display_start_0<const> = 0x05000000
local gp1_horizontal_256_pal<const> = 0x06c6a27e
local gp1_horizontal_320_pal<const> = 0x06c6e27e
local gp1_vertical_192_pal<const> = 0x07038c23
local gp1_vertical_240_pal<const> = 0x07044c23
local gp1_display_mode_256_pal<const> = 0x08000008
local gp1_display_mode_320_pal<const> = 0x08000009

local gp0_fill_rectangle<const> = 0x02000000
local gp0_draw_rectangle<const> = 0x60000000
local gp0_draw_triangle<const> = 0x20000000
local gp0_draw_quad<const> = 0x28000000
local gp0_draw_semitransparent_quad<const> = 0x2a000000
local gp0_draw_gouraud_triangle<const> = 0x30000000
local gp0_draw_textured_quad<const> = 0x2c000000
local gp0_draw_raw_textured_quad<const> = 0x2d000000
local gp0_draw_textured_rectangle<const> = 0x64000000
local gp0_draw_raw_textured_rectangle<const> = 0x65000000
local gp0_draw_semitransparent_rectangle<const> = 0x62000000
local gp0_draw_line<const> = 0x40000000
local gp0_cpu_to_vram<const> = 0xa0000000
local gp0_draw_mode<const> = 0xe1000000
local gp0_drawing_area_top_left_0<const> = 0xe3000000
local gp0_drawing_area_bottom_right_256x192<const> = 0xe402fcff
local gp0_drawing_area_bottom_right_320x240<const> = 0xe403bd3f
local gp0_drawing_offset_0<const> = 0xe5000000
local gp0_mask_bit_mode_0<const> = 0xe6000000

local draw_mode_blend_half<const> = 0x00000000
local draw_mode_blend_add<const> = 0x00000020
local draw_mode_blend_subtract<const> = 0x00000040
local draw_mode_blend_quarter<const> = 0x00000060
local texture_mode_palette4<const> = 0x00000000
local texture_mode_direct16<const> = 0x00000002
local draw_mode_texture_palette4<const> = texture_mode_palette4 << 7
local draw_mode_texture_direct16<const> = texture_mode_direct16 << 7

local display_width<const> = 320
local display_height<const> = 240
local display_size_256x192<const> = 0x00c00100
local display_size_320x240<const> = 0x00f00140
local texture_page_span<const> = 256
local sqrt<const> = require('bios/math').sqrt

local current_draw_mode = 0
local current_display_size_word = 0

local argb_to_gp0_rgb<const> = function(color)
	return ((color & 0x00ff0000) >> 16) | (color & 0x0000ff00) | ((color & 0x000000ff) << 16)
end

local argb_to_gp0_texture_rgb<const> = function(color)
	return (((((color >> 16) & 0x000000ff) * 128) + 127) // 255)
		| ((((((color >> 8) & 0x000000ff) * 128) + 127) // 255) << 8)
		| (((((color & 0x000000ff) * 128) + 127) // 255) << 16)
end

local xy<const> = function(x, y)
	return (round_to_nearest(x) & 0x0000ffff) | ((round_to_nearest(y) & 0x0000ffff) << 16)
end

local wh<const> = function(width, height)
	return (round_to_nearest(width) & 0x0000ffff) | ((round_to_nearest(height) & 0x0000ffff) << 16)
end

local uv<const> = function(u, v)
	return (u & 0x000000ff) | ((v & 0x000000ff) << 8)
end

local uv_texpage<const> = function(u, v, draw_mode)
	return uv(u, v) | (draw_mode << 16)
end

local rgba8888_to_direct16<const> = function(color)
	if (color & 0xff000000) == 0 then
		return 0
	end
	local direct16<const> = ((color & 0x000000f8) >> 3) | ((color & 0x0000f800) >> 6) | ((color & 0x00f80000) >> 9)
	return direct16 | 0x00008000
end

local draw_mode_for_texture_page<const> = function(source_x, source_y)
	return draw_mode_texture_direct16 | (current_draw_mode & 0x00000060) | (((source_x >> 8) & 0x00000003) << 2) | ((source_y & 0x00000100) >> 4)
end

local draw_mode_for_palette4_page<const> = function(texture_x, source_x, source_y)
	local page_x<const> = texture_x + ((source_x >> 8) << 6)
	return draw_mode_texture_palette4 | (current_draw_mode & 0x00000060) | ((page_x >> 6) & 0x0000000f) | ((source_y & 0x00000100) >> 4)
end

local uv_clut<const> = function(u, v, clut_x, clut_y)
	return uv(u, v) | ((((clut_x >> 4) & 0x0000003f) | ((clut_y & 0x000001ff) << 6)) << 16)
end

local texture_page_remaining<const> = function(source_coord)
	return texture_page_span - (source_coord & 0x000000ff)
end

function gx_gpu.reset_320x240_pal()
	*gp1 = gp1_reset
	*gp1 = gp1_display_mode_320_pal
	*gp1 = gp1_display_start_0
	*gp1 = gp1_horizontal_320_pal
	*gp1 = gp1_vertical_240_pal
	current_display_size_word = display_size_320x240
	current_draw_mode = draw_mode_blend_half
	*gp0 = gp0_draw_mode | current_draw_mode
	*gp0 = gp0_drawing_area_top_left_0
	*gp0 = gp0_drawing_area_bottom_right_320x240
	*gp0 = gp0_drawing_offset_0
	*gp0 = gp0_mask_bit_mode_0
	*gp1 = gp1_display_enable
end

function gx_gpu.reset_256x192_pal()
	*gp1 = gp1_reset
	*gp1 = gp1_display_mode_256_pal
	*gp1 = gp1_display_start_0
	*gp1 = gp1_horizontal_256_pal
	*gp1 = gp1_vertical_192_pal
	current_display_size_word = display_size_256x192
	current_draw_mode = draw_mode_blend_half
	*gp0 = gp0_draw_mode | current_draw_mode
	*gp0 = gp0_drawing_area_top_left_0
	*gp0 = gp0_drawing_area_bottom_right_256x192
	*gp0 = gp0_drawing_offset_0
	*gp0 = gp0_mask_bit_mode_0
	*gp1 = gp1_display_enable
end

function gx_gpu.clear_color(color)
	*gp0 = gp0_fill_rectangle | argb_to_gp0_rgb(color)
	*gp0 = 0x00000000
	*gp0 = current_display_size_word
end

local emit_rect_color<const> = function(opcode, x0, y0, x1, y1, color)
	*gp0 = opcode | argb_to_gp0_rgb(color)
	*gp0 = xy(x0, y0)
	*gp0 = wh(x1 - x0, y1 - y0)
end

function gx_gpu.fill_rect_color(x0, y0, x1, y1, color)
	emit_rect_color(gp0_draw_rectangle, x0, y0, x1, y1, color)
end

function gx_gpu.set_draw_mode(draw_mode)
	current_draw_mode = draw_mode
	*gp0 = gp0_draw_mode | draw_mode
end

function gx_gpu.fill_rect_semitrans_color(x0, y0, x1, y1, color)
	emit_rect_color(gp0_draw_semitransparent_rectangle, x0, y0, x1, y1, color)
end

function gx_gpu.draw_line_color(x0, y0, x1, y1, color)
	*gp0 = gp0_draw_line | argb_to_gp0_rgb(color)
	*gp0 = xy(x0, y0)
	*gp0 = xy(x1, y1)
end

local emit_quad_color<const> = function(opcode, x0, y0, x1, y1, x2, y2, x3, y3, color)
	*gp0 = opcode | argb_to_gp0_rgb(color)
	*gp0 = xy(x0, y0)
	*gp0 = xy(x1, y1)
	*gp0 = xy(x2, y2)
	*gp0 = xy(x3, y3)
end

local draw_thick_line<const> = function(rect_opcode, quad_opcode, x0, y0, x1, y1, color, thickness)
	local dx<const> = x1 - x0
	local dy<const> = y1 - y0
	local half<const> = thickness * 0.5
	if dx == 0 and dy == 0 then
		emit_rect_color(rect_opcode, x0 - half, y0 - half, x0 + half, y0 + half, color)
		return
	end
	local length<const> = sqrt(dx * dx + dy * dy)
	local tangent_x<const> = dx / length
	local tangent_y<const> = dy / length
	local normal_x<const> = -tangent_y
	local normal_y<const> = tangent_x
	emit_quad_color(
		quad_opcode,
		x0 - tangent_x * half - normal_x * half,
		y0 - tangent_y * half - normal_y * half,
		x1 + tangent_x * half - normal_x * half,
		y1 + tangent_y * half - normal_y * half,
		x0 - tangent_x * half + normal_x * half,
		y0 - tangent_y * half + normal_y * half,
		x1 + tangent_x * half + normal_x * half,
		y1 + tangent_y * half + normal_y * half,
		color
	)
end

function gx_gpu.draw_thick_line_color(x0, y0, x1, y1, color, thickness)
	draw_thick_line(gp0_draw_rectangle, gp0_draw_quad, x0, y0, x1, y1, color, thickness)
end

function gx_gpu.draw_thick_line_semitrans_color(x0, y0, x1, y1, color, thickness)
	draw_thick_line(gp0_draw_semitransparent_rectangle, gp0_draw_semitransparent_quad, x0, y0, x1, y1, color, thickness)
end

function gx_gpu.draw_triangle_color(x0, y0, x1, y1, x2, y2, color)
	*gp0 = gp0_draw_triangle | argb_to_gp0_rgb(color)
	*gp0 = xy(x0, y0)
	*gp0 = xy(x1, y1)
	*gp0 = xy(x2, y2)
end

function gx_gpu.draw_gouraud_triangle_color(x0, y0, color0, x1, y1, color1, x2, y2, color2)
	*gp0 = gp0_draw_gouraud_triangle | argb_to_gp0_rgb(color0)
	*gp0 = xy(x0, y0)
	*gp0 = argb_to_gp0_rgb(color1)
	*gp0 = xy(x1, y1)
	*gp0 = argb_to_gp0_rgb(color2)
	*gp0 = xy(x2, y2)
end

function gx_gpu.upload_rgba8888_to_direct16_stride(source_addr, source_x, source_y, source_stride, target_x, target_y, width, height)
	*gp0 = gp0_cpu_to_vram
	*gp0 = xy(target_x, target_y)
	*gp0 = wh(width, height)
	local source_words<const>: *word = source_addr
	local pending_word = 0
	local pending_half = 0
	for row = 0, height - 1 do
		local source_index<const> = (source_y + row) * source_stride + source_x
		for column = 0, width - 1 do
			local pixel<const> = rgba8888_to_direct16(source_words[source_index + column])
			if pending_half == 0 then
				pending_word = pixel
				pending_half = 1
			else
				*gp0 = pending_word | (pixel << 16)
				pending_half = 0
			end
		end
	end
	if pending_half ~= 0 then
		*gp0 = pending_word
	end
end

function gx_gpu.draw_direct16_textured_rect_color(source_x, source_y, x, y, width, height, color)
	local raw_texture<const> = (color & 0x00ffffff) == 0x00ffffff
	local textured_word
	if not raw_texture then
		textured_word = gp0_draw_textured_rectangle | argb_to_gp0_texture_rgb(color)
	end
	if width <= texture_page_remaining(source_x) and height <= texture_page_remaining(source_y) then
		*gp0 = gp0_draw_mode | draw_mode_for_texture_page(source_x, source_y)
		if raw_texture then
			*gp0 = gp0_draw_raw_textured_rectangle | 0x00808080
		else
			*gp0 = textured_word
		end
		*gp0 = xy(x, y)
		*gp0 = (source_x & 0x000000ff) | ((source_y & 0x000000ff) << 8)
		*gp0 = wh(width, height)
		return
	end
	local remaining_h = height
	local draw_source_y = source_y
	local draw_y = y
	while remaining_h > 0 do
		local chunk_h = texture_page_remaining(draw_source_y)
		if chunk_h > remaining_h then
			chunk_h = remaining_h
		end
		local remaining_w = width
		local draw_source_x = source_x
		local draw_x = x
		while remaining_w > 0 do
			local chunk_w = texture_page_remaining(draw_source_x)
			if chunk_w > remaining_w then
				chunk_w = remaining_w
			end
			*gp0 = gp0_draw_mode | draw_mode_for_texture_page(draw_source_x, draw_source_y)
			if raw_texture then
				*gp0 = gp0_draw_raw_textured_rectangle | 0x00808080
			else
				*gp0 = textured_word
			end
			*gp0 = xy(draw_x, draw_y)
			*gp0 = (draw_source_x & 0x000000ff) | ((draw_source_y & 0x000000ff) << 8)
			*gp0 = wh(chunk_w, chunk_h)
			remaining_w = remaining_w - chunk_w
			draw_source_x = draw_source_x + chunk_w
			draw_x = draw_x + chunk_w
		end
		remaining_h = remaining_h - chunk_h
		draw_source_y = draw_source_y + chunk_h
		draw_y = draw_y + chunk_h
	end
end

function gx_gpu.draw_palette4_textured_rect_color(texture_x, clut_x, clut_y, source_x, source_y, x, y, width, height, color)
	*gp0 = gp0_draw_mode | draw_mode_for_palette4_page(texture_x, source_x, source_y)
	if (color & 0x00ffffff) == 0x00ffffff then
		*gp0 = gp0_draw_raw_textured_rectangle | 0x00808080
	else
		*gp0 = gp0_draw_textured_rectangle | argb_to_gp0_texture_rgb(color)
	end
	*gp0 = xy(x, y)
	*gp0 = uv_clut(source_x, source_y, clut_x, clut_y)
	*gp0 = wh(width, height)
end

function gx_gpu.draw_direct16_textured_quad_color(
	page_source_x, page_source_y,
	source_x0, source_y0,
	source_x1, source_y1,
	source_x2, source_y2,
	source_x3, source_y3,
	x0, y0,
	x1, y1,
	x2, y2,
	x3, y3,
	color)
	local draw_mode<const> = draw_mode_for_texture_page(page_source_x, page_source_y)
	*gp0 = gp0_draw_mode | draw_mode
	if (color & 0x00ffffff) == 0x00ffffff then
		*gp0 = gp0_draw_raw_textured_quad | 0x00808080
	else
		*gp0 = gp0_draw_textured_quad | argb_to_gp0_texture_rgb(color)
	end
	*gp0 = xy(x0, y0)
	*gp0 = uv(source_x0, source_y0)
	*gp0 = xy(x1, y1)
	*gp0 = uv_texpage(source_x1, source_y1, draw_mode)
	*gp0 = xy(x2, y2)
	*gp0 = uv(source_x2, source_y2)
	*gp0 = xy(x3, y3)
	*gp0 = uv(source_x3, source_y3)
end

function gx_gpu.draw_palette4_textured_quad_color(
	texture_x, clut_x, clut_y,
	page_source_x, page_source_y,
	source_x0, source_y0,
	source_x1, source_y1,
	source_x2, source_y2,
	source_x3, source_y3,
	x0, y0,
	x1, y1,
	x2, y2,
	x3, y3,
	color)
	local draw_mode<const> = draw_mode_for_palette4_page(texture_x, page_source_x, page_source_y)
	*gp0 = gp0_draw_mode | draw_mode
	if (color & 0x00ffffff) == 0x00ffffff then
		*gp0 = gp0_draw_raw_textured_quad | 0x00808080
	else
		*gp0 = gp0_draw_textured_quad | argb_to_gp0_texture_rgb(color)
	end
	*gp0 = xy(x0, y0)
	*gp0 = uv_clut(source_x0, source_y0, clut_x, clut_y)
	*gp0 = xy(x1, y1)
	*gp0 = uv_texpage(source_x1, source_y1, draw_mode)
	*gp0 = xy(x2, y2)
	*gp0 = uv(source_x2, source_y2)
	*gp0 = xy(x3, y3)
	*gp0 = uv(source_x3, source_y3)
end

gx_gpu.draw_mode_blend_half = draw_mode_blend_half
gx_gpu.draw_mode_blend_add = draw_mode_blend_add
gx_gpu.draw_mode_blend_subtract = draw_mode_blend_subtract
gx_gpu.draw_mode_blend_quarter = draw_mode_blend_quarter
gx_gpu.texture_mode_palette4 = texture_mode_palette4
gx_gpu.texture_mode_direct16 = texture_mode_direct16
gx_gpu.display_width = display_width
gx_gpu.display_height = display_height
gx_gpu.texture_page_span = texture_page_span

return gx_gpu
