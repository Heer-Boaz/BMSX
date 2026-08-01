local round_to_nearest<const> = math.round
local gx_gpu<const> = {}

local gp0<const>: *word = 0x08010238
local gp1<const>: *word = 0x0801023c

local gp1_ack_irq<const> = 0x02000000

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
local gp0_irq_request<const> = 0x1f000000
local gp0_vram_to_vram<const> = 0x80000000
local gp0_draw_mode<const> = 0xe1000000
local gp0_drawing_area_top_left<const> = 0xe3000000
local gp0_drawing_area_bottom_right<const> = 0xe4000000
local gp0_drawing_offset<const> = 0xe5000000
local gp0_mask_bit_mode<const> = 0xe6000000

local draw_mode_blend_half<const> = 0x00000000
local draw_mode_blend_add<const> = 0x00000020
local draw_mode_blend_subtract<const> = 0x00000040
local draw_mode_blend_quarter<const> = 0x00000060
local texture_mode_palette4<const> = 0x00000000
local texture_mode_direct16<const> = 0x00000002
local draw_mode_texture_palette4<const> = texture_mode_palette4 << 7
local draw_mode_texture_direct16<const> = texture_mode_direct16 << 7
local draw_mode_texture_rectangle_x_flip<const> = 0x00001000
local draw_mode_texture_rectangle_y_flip<const> = 0x00002000

local texture_page_span<const> = 256

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

local draw_mode_for_texture_page<const> = function(source_x, source_y, blend_mode)
	return draw_mode_texture_direct16 | blend_mode | (((source_x >> 8) & 0x00000003) << 2) | ((source_y & 0x00000100) >> 4) | ((source_y & 0x00000200) << 2)
end

local draw_mode_for_palette4_page<const> = function(texture_x, source_x, source_y, blend_mode)
	local page_x<const> = texture_x + ((source_x >> 8) << 6)
	return draw_mode_texture_palette4 | blend_mode | ((page_x >> 6) & 0x0000000f) | ((source_y & 0x00000100) >> 4) | ((source_y & 0x00000200) << 2)
end

local uv_clut<const> = function(u, v, clut_x, clut_y)
	return uv(u, v) | ((((clut_x >> 4) & 0x0000003f) | ((clut_y & 0x000003ff) << 6)) << 16)
end

function gx_gpu.draw_target(origin_word, size_word)
	local x<const> = origin_word & 0x0000ffff
	local y<const> = origin_word >> 16
	local width<const> = size_word & 0x0000ffff
	local height<const> = size_word >> 16
	*gp0 = gp0_drawing_area_top_left | x | (y << 10)
	*gp0 = gp0_drawing_area_bottom_right | (x + width - 1) | ((y + height - 1) << 10)
	*gp0 = gp0_drawing_offset | (x & 0x000007ff) | ((y & 0x000007ff) << 11)
end

function gx_gpu.ack_irq()
	*gp1 = gp1_ack_irq
end

function gx_gpu.encode_fill_rectangle(words, index, x, y, width, height, color_word)
	local target<const>: *word = words
	target[index] = gp0_fill_rectangle | color_word
	target[index + 1] = xy(x, y)
	target[index + 2] = wh(width, height)
	return index + 3
end

function gx_gpu.encode_rectangle(words, index, x, y, width, height, color_word)
	local target<const>: *word = words
	target[index] = gp0_draw_rectangle | color_word
	target[index + 1] = xy(x, y)
	target[index + 2] = wh(width, height)
	return index + 3
end

function gx_gpu.encode_vram_copy(words, index, source_x, source_y, target_x, target_y, width, height)
	local target<const>: *word = words
	target[index] = gp0_vram_to_vram
	target[index + 1] = xy(source_x, source_y)
	target[index + 2] = xy(target_x, target_y)
	target[index + 3] = wh(width, height)
	return index + 4
end

function gx_gpu.encode_direct16_texture_page(words, index, source_x, source_y, blend_mode)
	local target<const>: *word = words
	target[index] = gp0_draw_mode | draw_mode_for_texture_page(source_x, source_y, blend_mode)
	return index + 1
end

function gx_gpu.encode_textured_rectangle(words, index, source_x, source_y, x, y, width, height, color_word)
	local target<const>: *word = words
	target[index] = gp0_draw_textured_rectangle | color_word
	target[index + 1] = xy(x, y)
	target[index + 2] = uv(source_x, source_y)
	target[index + 3] = wh(width, height)
	return index + 4
end

function gx_gpu.encode_irq_request(words, index)
	local target<const>: *word = words
	target[index] = gp0_irq_request
	return index + 1
end

function gx_gpu.encode_mask_bit_mode(words, index, mode_word)
	local target<const>: *word = words
	target[index] = gp0_mask_bit_mode | mode_word
	return index + 1
end

function gx_gpu.clear_color(origin_word, size_word, color)
	*gp0 = gp0_fill_rectangle | argb_to_gp0_rgb(color)
	*gp0 = origin_word
	*gp0 = size_word
end

function gx_gpu.request_irq()
	*gp0 = gp0_irq_request
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
	*gp0 = gp0_draw_mode | draw_mode
end

function gx_gpu.set_mask_bit_mode(mode_word)
	*gp0 = gp0_mask_bit_mode | mode_word
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

function gx_gpu.draw_quad_color(x0, y0, x1, y1, x2, y2, x3, y3, color)
	emit_quad_color(gp0_draw_quad, x0, y0, x1, y1, x2, y2, x3, y3, color)
end

function gx_gpu.draw_quad_semitrans_color(x0, y0, x1, y1, x2, y2, x3, y3, color)
	emit_quad_color(gp0_draw_semitransparent_quad, x0, y0, x1, y1, x2, y2, x3, y3, color)
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

function gx_gpu.draw_direct16_textured_rect_color(source_x, source_y, x, y, width, height, color, rectangle_flip_mode, blend_mode)
	local raw_texture<const> = (color & 0x00ffffff) == 0x00ffffff
	local texture_x<const> = (rectangle_flip_mode & draw_mode_texture_rectangle_x_flip) ~= 0 and source_x + width - 1 or source_x
	local texture_y<const> = (rectangle_flip_mode & draw_mode_texture_rectangle_y_flip) ~= 0 and source_y + height - 1 or source_y
	local draw_mode_word<const> = draw_mode_for_texture_page(texture_x, texture_y, blend_mode) | rectangle_flip_mode
	*gp0 = gp0_draw_mode | draw_mode_word
	if raw_texture then
		*gp0 = gp0_draw_raw_textured_rectangle | 0x00808080
	else
		*gp0 = gp0_draw_textured_rectangle | argb_to_gp0_texture_rgb(color)
	end
	*gp0 = xy(x, y)
	*gp0 = (texture_x & 0x000000ff) | ((texture_y & 0x000000ff) << 8)
	*gp0 = wh(width, height)
end

function gx_gpu.draw_palette4_textured_rect_color(texture_x, clut_x, clut_y, source_x, source_y, x, y, width, height, color, rectangle_flip_mode, blend_mode)
	local texture_source_x<const> = (rectangle_flip_mode & draw_mode_texture_rectangle_x_flip) ~= 0 and source_x + width - 1 or source_x
	local texture_source_y<const> = (rectangle_flip_mode & draw_mode_texture_rectangle_y_flip) ~= 0 and source_y + height - 1 or source_y
	local draw_mode_word<const> = draw_mode_for_palette4_page(texture_x, texture_source_x, texture_source_y, blend_mode) | rectangle_flip_mode
	*gp0 = gp0_draw_mode | draw_mode_word
	if (color & 0x00ffffff) == 0x00ffffff then
		*gp0 = gp0_draw_raw_textured_rectangle | 0x00808080
	else
		*gp0 = gp0_draw_textured_rectangle | argb_to_gp0_texture_rgb(color)
	end
	*gp0 = xy(x, y)
	*gp0 = uv_clut(texture_source_x, texture_source_y, clut_x, clut_y)
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
	color,
	blend_mode)
	local draw_mode<const> = draw_mode_for_texture_page(page_source_x, page_source_y, blend_mode)
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
	color,
	blend_mode)
	local draw_mode<const> = draw_mode_for_palette4_page(texture_x, page_source_x, page_source_y, blend_mode)
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
gx_gpu.texture_page_span = texture_page_span

return gx_gpu
