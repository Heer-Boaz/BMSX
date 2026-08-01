local gp0<const> = require('cartlib/gx/gp0')

local gx_gpu<const> = {}

local gp0_register<const>: *word = 0x08010238
local gp1<const>: *word = 0x0801023c
local gp1_ack_irq<const> = 0x02000000

function gx_gpu.draw_target(origin_word, size_word)
	local x<const> = origin_word & 0x0000ffff
	local y<const> = origin_word >> 16
	local width<const> = size_word & 0x0000ffff
	local height<const> = size_word >> 16
	*gp0_register = gp0.drawing_area_top_left | x | (y << 10)
	*gp0_register = gp0.drawing_area_bottom_right | (x + width - 1) | ((y + height - 1) << 10)
	*gp0_register = gp0.drawing_offset | (x & 0x000007ff) | ((y & 0x000007ff) << 11)
end

function gx_gpu.ack_irq()
	*gp1 = gp1_ack_irq
end

function gx_gpu.clear_color(origin_word, size_word, color)
	*gp0_register = gp0.fill_rectangle | gp0.argb_to_rgb(color)
	*gp0_register = origin_word
	*gp0_register = size_word
end

local emit_rect_color<const> = function(opcode, x0, y0, x1, y1, color)
	*gp0_register = opcode | gp0.argb_to_rgb(color)
	*gp0_register = gp0.pair16(x0, y0)
	*gp0_register = gp0.pair16(x1 - x0, y1 - y0)
end

function gx_gpu.fill_rect_color(x0, y0, x1, y1, color)
	emit_rect_color(gp0.draw_rectangle, x0, y0, x1, y1, color)
end

function gx_gpu.set_draw_mode(draw_mode)
	*gp0_register = gp0.draw_mode | draw_mode
end

function gx_gpu.set_mask_bit_mode(mode_word)
	*gp0_register = gp0.mask_bit_mode | mode_word
end

function gx_gpu.fill_rect_semitrans_color(x0, y0, x1, y1, color)
	emit_rect_color(gp0.draw_semitransparent_rectangle, x0, y0, x1, y1, color)
end

function gx_gpu.draw_line_color(x0, y0, x1, y1, color)
	*gp0_register = gp0.draw_line | gp0.argb_to_rgb(color)
	*gp0_register = gp0.pair16(x0, y0)
	*gp0_register = gp0.pair16(x1, y1)
end

local emit_quad_color<const> = function(opcode, x0, y0, x1, y1, x2, y2, x3, y3, color)
	*gp0_register = opcode | gp0.argb_to_rgb(color)
	*gp0_register = gp0.pair16(x0, y0)
	*gp0_register = gp0.pair16(x1, y1)
	*gp0_register = gp0.pair16(x2, y2)
	*gp0_register = gp0.pair16(x3, y3)
end

function gx_gpu.draw_quad_color(x0, y0, x1, y1, x2, y2, x3, y3, color)
	emit_quad_color(gp0.draw_quad, x0, y0, x1, y1, x2, y2, x3, y3, color)
end

function gx_gpu.draw_quad_semitrans_color(x0, y0, x1, y1, x2, y2, x3, y3, color)
	emit_quad_color(gp0.draw_semitransparent_quad, x0, y0, x1, y1, x2, y2, x3, y3, color)
end

function gx_gpu.draw_triangle_color(x0, y0, x1, y1, x2, y2, color)
	*gp0_register = gp0.draw_triangle | gp0.argb_to_rgb(color)
	*gp0_register = gp0.pair16(x0, y0)
	*gp0_register = gp0.pair16(x1, y1)
	*gp0_register = gp0.pair16(x2, y2)
end

function gx_gpu.draw_gouraud_triangle_color(x0, y0, color0, x1, y1, color1, x2, y2, color2)
	*gp0_register = gp0.draw_gouraud_triangle | gp0.argb_to_rgb(color0)
	*gp0_register = gp0.pair16(x0, y0)
	*gp0_register = gp0.argb_to_rgb(color1)
	*gp0_register = gp0.pair16(x1, y1)
	*gp0_register = gp0.argb_to_rgb(color2)
	*gp0_register = gp0.pair16(x2, y2)
end

function gx_gpu.draw_direct16_textured_rect_color(source_x, source_y, x, y, width, height, color, rectangle_flip_mode, blend_mode)
	local raw_texture<const> = (color & 0x00ffffff) == 0x00ffffff
	local texture_x<const> = (rectangle_flip_mode & gp0.draw_mode_texture_rectangle_x_flip) ~= 0 and source_x + width - 1 or source_x
	local texture_y<const> = (rectangle_flip_mode & gp0.draw_mode_texture_rectangle_y_flip) ~= 0 and source_y + height - 1 or source_y
	local draw_mode_word<const> = gp0.direct16_draw_mode(texture_x, texture_y, blend_mode) | rectangle_flip_mode
	*gp0_register = gp0.draw_mode | draw_mode_word
	if raw_texture then
		*gp0_register = gp0.draw_raw_textured_rectangle | 0x00808080
	else
		*gp0_register = gp0.draw_textured_rectangle | gp0.argb_to_texture_rgb(color)
	end
	*gp0_register = gp0.pair16(x, y)
	*gp0_register = (texture_x & 0x000000ff) | ((texture_y & 0x000000ff) << 8)
	*gp0_register = gp0.pair16(width, height)
end

function gx_gpu.draw_palette4_textured_rect_color(texture_x, clut_x, clut_y, source_x, source_y, x, y, width, height, color, rectangle_flip_mode, blend_mode)
	local texture_source_x<const> = (rectangle_flip_mode & gp0.draw_mode_texture_rectangle_x_flip) ~= 0 and source_x + width - 1 or source_x
	local texture_source_y<const> = (rectangle_flip_mode & gp0.draw_mode_texture_rectangle_y_flip) ~= 0 and source_y + height - 1 or source_y
	local draw_mode_word<const> = gp0.palette4_draw_mode(texture_x, texture_source_x, texture_source_y, blend_mode) | rectangle_flip_mode
	*gp0_register = gp0.draw_mode | draw_mode_word
	if (color & 0x00ffffff) == 0x00ffffff then
		*gp0_register = gp0.draw_raw_textured_rectangle | 0x00808080
	else
		*gp0_register = gp0.draw_textured_rectangle | gp0.argb_to_texture_rgb(color)
	end
	*gp0_register = gp0.pair16(x, y)
	*gp0_register = gp0.uv_clut(texture_source_x, texture_source_y, clut_x, clut_y)
	*gp0_register = gp0.pair16(width, height)
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
	local draw_mode<const> = gp0.direct16_draw_mode(page_source_x, page_source_y, blend_mode)
	*gp0_register = gp0.draw_mode | draw_mode
	if (color & 0x00ffffff) == 0x00ffffff then
		*gp0_register = gp0.draw_raw_textured_quad | 0x00808080
	else
		*gp0_register = gp0.draw_textured_quad | gp0.argb_to_texture_rgb(color)
	end
	*gp0_register = gp0.pair16(x0, y0)
	*gp0_register = gp0.uv(source_x0, source_y0)
	*gp0_register = gp0.pair16(x1, y1)
	*gp0_register = gp0.uv_texpage(source_x1, source_y1, draw_mode)
	*gp0_register = gp0.pair16(x2, y2)
	*gp0_register = gp0.uv(source_x2, source_y2)
	*gp0_register = gp0.pair16(x3, y3)
	*gp0_register = gp0.uv(source_x3, source_y3)
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
	local draw_mode<const> = gp0.palette4_draw_mode(texture_x, page_source_x, page_source_y, blend_mode)
	*gp0_register = gp0.draw_mode | draw_mode
	if (color & 0x00ffffff) == 0x00ffffff then
		*gp0_register = gp0.draw_raw_textured_quad | 0x00808080
	else
		*gp0_register = gp0.draw_textured_quad | gp0.argb_to_texture_rgb(color)
	end
	*gp0_register = gp0.pair16(x0, y0)
	*gp0_register = gp0.uv_clut(source_x0, source_y0, clut_x, clut_y)
	*gp0_register = gp0.pair16(x1, y1)
	*gp0_register = gp0.uv_texpage(source_x1, source_y1, draw_mode)
	*gp0_register = gp0.pair16(x2, y2)
	*gp0_register = gp0.uv(source_x2, source_y2)
	*gp0_register = gp0.pair16(x3, y3)
	*gp0_register = gp0.uv(source_x3, source_y3)
end

return gx_gpu
